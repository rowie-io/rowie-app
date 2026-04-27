import { useCallback, useContext, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useSocket, useSocketEvent, SocketEvents } from '../context/SocketContext';
import { StripeTerminalContext } from '../context/StripeTerminalContext';
import logger from '../lib/logger';

// Component that listens for socket events and updates contexts
export function SocketEventHandlers() {
  const { refreshAuth, isAuthenticated, organization } = useAuth();
  const queryClient = useQueryClient();
  const { isConnected } = useSocket();
  // Use context directly (nullable) since this component lives outside StripeTerminalContextProvider
  const terminalContext = useContext(StripeTerminalContext);
  const setTerminalPaymentResult = terminalContext?.setTerminalPaymentResult;
  const wasConnectedRef = useRef(isConnected);
  const hasEverConnectedRef = useRef(false);
  const wasAuthenticatedRef = useRef(isAuthenticated);

  // Defense-in-depth: verify event is for this org before processing.
  // Mirrors the vendor SocketContext `isMyOrg` gate. The server scopes
  // emits to org rooms today (via `emitToOrganization`, which stamps
  // `organizationId` into payloads), but if a future room-scoping
  // regression ever leaks a foreign emit into our connection we must
  // not blindly invalidate caches or mutate Terminal state with another
  // org's data. Permissive when `organizationId` is missing so user/
  // device-room emits (which legitimately omit it) still flow through.
  const orgIdRef = useRef(organization?.id);
  useEffect(() => {
    orgIdRef.current = organization?.id;
  }, [organization?.id]);
  const isMyOrg = useCallback((data: any): boolean => {
    if (!data?.organizationId) return true;
    return !!orgIdRef.current && data.organizationId === orgIdRef.current;
  }, []);

  // Clear React Query cache on logout / session-kick so the next login does
  // not inherit stale data (orders, sessions, transactions) from the previous
  // user. Triggered on the authenticated → unauthenticated transition.
  useEffect(() => {
    if (wasAuthenticatedRef.current && !isAuthenticated) {
      logger.log('[SocketEventHandlers] Auth lost, clearing React Query cache');
      queryClient.clear();
    }
    wasAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated, queryClient]);

  // Invalidate all queries when socket REconnects (not on initial connection)
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current && hasEverConnectedRef.current) {
      logger.log('[SocketEventHandlers] Socket reconnected, invalidating all queries');
      queryClient.invalidateQueries();
    }
    if (isConnected) hasEverConnectedRef.current = true;
    wasConnectedRef.current = isConnected;
  }, [isConnected, queryClient]);

  // Handle user/organization updates
  // USER_UPDATED is dispatched via `emitToUser` (user-room scoped) — payload
  // doesn't carry organizationId, so isMyOrg's permissive branch is the
  // right gate. Calling it keeps the source-guard pattern uniform.
  const handleUserUpdate = useCallback((data: any) => {
    if (!isMyOrg(data)) return;
    logger.log('[SocketEventHandlers] User update received via socket');
    refreshAuth();
  }, [refreshAuth, isMyOrg]);

  const handleOrgUpdate = useCallback((data: any) => {
    if (!isMyOrg(data)) return;
    logger.log('[SocketEventHandlers] Organization update received via socket');
    refreshAuth();
  }, [refreshAuth, isMyOrg]);

  // Handle event updates
  const handleEventUpdate = useCallback((data: any) => {
    if (!isMyOrg(data)) return;
    logger.log('[SocketEventHandlers] Event update received via socket');
    queryClient.invalidateQueries({ queryKey: ['events'] });
  }, [queryClient, isMyOrg]);

  // Handle transaction-affecting events globally so the cache stays fresh
  // even when TransactionsScreen is not mounted
  const handleTransactionEvent = useCallback((data: any) => {
    if (!isMyOrg(data)) return;
    logger.log('[SocketEventHandlers] Transaction-affecting event, invalidating cache');
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
  }, [queryClient, isMyOrg]);

  useSocketEvent(SocketEvents.USER_UPDATED, handleUserUpdate);
  useSocketEvent(SocketEvents.ORGANIZATION_UPDATED, handleOrgUpdate);
  useSocketEvent(SocketEvents.EVENT_CREATED, handleEventUpdate);
  useSocketEvent(SocketEvents.EVENT_UPDATED, handleEventUpdate);
  useSocketEvent(SocketEvents.EVENT_DELETED, handleEventUpdate);
  useSocketEvent(SocketEvents.ORDER_COMPLETED, handleTransactionEvent);
  useSocketEvent(SocketEvents.PAYMENT_RECEIVED, handleTransactionEvent);
  useSocketEvent(SocketEvents.ORDER_REFUNDED, handleTransactionEvent);
  useSocketEvent(SocketEvents.SESSION_SETTLED, handleTransactionEvent);
  useSocketEvent(SocketEvents.SESSION_CANCELLED, handleTransactionEvent);

  // Terminal reader payment events (server-driven payments via smart readers)
  // Gate on isMyOrg: a misrouted emit from another org could otherwise flip
  // this device's terminal payment state to succeeded/failed for a foreign
  // PaymentIntent, mis-completing the in-flight checkout.
  const handleTerminalPaymentSucceeded = useCallback((data: any) => {
    if (!isMyOrg(data)) return;
    logger.log('[SocketEventHandlers] Terminal payment succeeded:', data?.paymentIntentId);
    setTerminalPaymentResult?.({
      status: 'succeeded',
      paymentIntentId: data?.paymentIntentId || '',
    });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
  }, [setTerminalPaymentResult, queryClient, isMyOrg]);

  const handleTerminalPaymentFailed = useCallback((data: any) => {
    if (!isMyOrg(data)) return;
    logger.log('[SocketEventHandlers] Terminal payment failed:', data?.paymentIntentId, data?.error);
    setTerminalPaymentResult?.({
      status: 'failed',
      paymentIntentId: data?.paymentIntentId || '',
      error: data?.error || 'Payment failed on reader',
    });
  }, [setTerminalPaymentResult, isMyOrg]);

  useSocketEvent(SocketEvents.TERMINAL_PAYMENT_SUCCEEDED, handleTerminalPaymentSucceeded);
  useSocketEvent(SocketEvents.TERMINAL_PAYMENT_FAILED, handleTerminalPaymentFailed);

  // This component doesn't render anything
  return null;
}
