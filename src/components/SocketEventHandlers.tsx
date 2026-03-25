import { useCallback, useContext, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useSocket, useSocketEvent, SocketEvents } from '../context/SocketContext';
import { StripeTerminalContext } from '../context/StripeTerminalContext';
import logger from '../lib/logger';

// Component that listens for socket events and updates contexts
export function SocketEventHandlers() {
  const { refreshAuth } = useAuth();
  const queryClient = useQueryClient();
  const { isConnected } = useSocket();
  // Use context directly (nullable) since this component lives outside StripeTerminalContextProvider
  const terminalContext = useContext(StripeTerminalContext);
  const setTerminalPaymentResult = terminalContext?.setTerminalPaymentResult;
  const wasConnectedRef = useRef(isConnected);
  const hasEverConnectedRef = useRef(false);

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
  const handleUserUpdate = useCallback(() => {
    logger.log('[SocketEventHandlers] User update received via socket');
    refreshAuth();
  }, [refreshAuth]);

  const handleOrgUpdate = useCallback(() => {
    logger.log('[SocketEventHandlers] Organization update received via socket');
    refreshAuth();
  }, [refreshAuth]);

  // Handle event updates
  const handleEventUpdate = useCallback(() => {
    logger.log('[SocketEventHandlers] Event update received via socket');
    queryClient.invalidateQueries({ queryKey: ['events'] });
  }, [queryClient]);

  // Handle transaction-affecting events globally so the cache stays fresh
  // even when TransactionsScreen is not mounted
  const handleTransactionEvent = useCallback((data: any) => {
    logger.log('[SocketEventHandlers] Transaction-affecting event, invalidating cache');
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
  }, [queryClient]);

  useSocketEvent(SocketEvents.USER_UPDATED, handleUserUpdate);
  useSocketEvent(SocketEvents.ORGANIZATION_UPDATED, handleOrgUpdate);
  useSocketEvent(SocketEvents.EVENT_CREATED, handleEventUpdate);
  useSocketEvent(SocketEvents.EVENT_UPDATED, handleEventUpdate);
  useSocketEvent(SocketEvents.EVENT_DELETED, handleEventUpdate);
  useSocketEvent(SocketEvents.ORDER_COMPLETED, handleTransactionEvent);
  useSocketEvent(SocketEvents.PAYMENT_RECEIVED, handleTransactionEvent);
  useSocketEvent(SocketEvents.ORDER_REFUNDED, handleTransactionEvent);
  useSocketEvent(SocketEvents.PREORDER_COMPLETED, handleTransactionEvent);
  useSocketEvent(SocketEvents.PREORDER_CANCELLED, handleTransactionEvent);

  // Terminal reader payment events (server-driven payments via smart readers)
  const handleTerminalPaymentSucceeded = useCallback((data: any) => {
    logger.log('[SocketEventHandlers] Terminal payment succeeded:', data?.paymentIntentId);
    setTerminalPaymentResult?.({
      status: 'succeeded',
      paymentIntentId: data?.paymentIntentId || '',
    });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
  }, [setTerminalPaymentResult, queryClient]);

  const handleTerminalPaymentFailed = useCallback((data: any) => {
    logger.log('[SocketEventHandlers] Terminal payment failed:', data?.paymentIntentId, data?.error);
    setTerminalPaymentResult?.({
      status: 'failed',
      paymentIntentId: data?.paymentIntentId || '',
      error: data?.error || 'Payment failed on reader',
    });
  }, [setTerminalPaymentResult]);

  useSocketEvent(SocketEvents.TERMINAL_PAYMENT_SUCCEEDED, handleTerminalPaymentSucceeded);
  useSocketEvent(SocketEvents.TERMINAL_PAYMENT_FAILED, handleTerminalPaymentFailed);

  // This component doesn't render anything
  return null;
}
