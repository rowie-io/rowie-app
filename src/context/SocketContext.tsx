import React, { createContext, useContext, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { config } from '../lib/config';
import { authService } from '../lib/api';
import { triggerSessionKicked } from '../lib/session-callbacks';
import { useAuth } from './AuthContext';
import { getDeviceId } from '../lib/device';
import logger from '../lib/logger';

// Socket event types
export const SocketEvents = {
  // User/Profile events
  USER_UPDATED: 'user:updated',
  ORGANIZATION_UPDATED: 'organization:updated',
  // Session events
  SESSION_KICKED: 'session:kicked', // Emitted when user logs in on another device
  // Subscription events
  SUBSCRIPTION_UPDATED: 'subscription:updated',
  // Catalog events
  CATALOG_UPDATED: 'catalog:updated',
  CATALOG_CREATED: 'catalog:created',
  CATALOG_DELETED: 'catalog:deleted',
  // Product events
  PRODUCT_UPDATED: 'product:updated',
  PRODUCT_CREATED: 'product:created',
  PRODUCT_DELETED: 'product:deleted',
  // Category events
  CATEGORY_UPDATED: 'category:updated',
  CATEGORY_CREATED: 'category:created',
  CATEGORY_DELETED: 'category:deleted',
  CATEGORIES_REORDERED: 'categories:reordered',
  // Transaction events
  TRANSACTION_CREATED: 'transaction:created',
  TRANSACTION_UPDATED: 'transaction:updated',
  // Order events
  ORDER_CREATED: 'order:created',
  ORDER_UPDATED: 'order:updated',
  ORDER_COMPLETED: 'order:completed',
  ORDER_FAILED: 'order:failed',
  ORDER_DELETED: 'order:deleted',
  PAYMENT_RECEIVED: 'payment:received',
  ORDER_REFUNDED: 'order:refunded',
  // Event/ticket events
  EVENT_CREATED: 'event:created',
  EVENT_UPDATED: 'event:updated',
  EVENT_DELETED: 'event:deleted',
  TICKET_PURCHASED: 'ticket:purchased',
  TICKET_SCANNED: 'ticket:scanned',
  TICKET_REFUNDED: 'ticket:refunded',
  // Preorder events
  PREORDER_CREATED: 'preorder:created',
  PREORDER_UPDATED: 'preorder:updated',
  PREORDER_READY: 'preorder:ready',
  PREORDER_COMPLETED: 'preorder:completed',
  PREORDER_CANCELLED: 'preorder:cancelled',
  // Terminal reader events (server-driven payments)
  TERMINAL_PAYMENT_SUCCEEDED: 'terminal:payment_succeeded',
  TERMINAL_PAYMENT_FAILED: 'terminal:payment_failed',
} as const;

type SocketEventName = typeof SocketEvents[keyof typeof SocketEvents];
type EventCallback = (data: any) => void;

interface SocketContextType {
  isConnected: boolean;
  subscribe: (event: SocketEventName, callback: EventCallback) => () => void;
  emit: (event: string, data: any) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

interface SocketProviderProps {
  children: ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps) {
  const { isAuthenticated } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const listenersRef = useRef<Map<string, Set<EventCallback>>>(new Map());
  const isRefreshingRef = useRef(false);
  const isSessionKickedRef = useRef(false);
  const lastUsedTokenRef = useRef<string | null>(null);
  const [isConnected, setIsConnected] = React.useState(false);

  // Verify session is still valid (called on reconnect/app foreground)
  const verifySession = useCallback(async () => {
    try {
      logger.log('[Socket] Verifying session is still valid...');
      const storedVersion = await authService.getSessionVersion();
      if (!storedVersion) {
        logger.log('[Socket] No stored session version, skipping check');
        return;
      }

      // Call API to check current session version
      const { user } = await authService.getProfile();

      // If we get here, the token is still valid
      // The API interceptor will handle 401s and kick us out if needed
      logger.log('[Socket] Session verified for:', user.email);
    } catch (error: any) {
      logger.log('[Socket] Session verification failed:', error.message);
      // If it's a 401 or session error, trigger the kicked callback
      if (error.message?.includes('session') || error.response?.status === 401) {
        logger.log('[Socket] Session invalid, triggering kick...');
        if (triggerSessionKicked) {
          triggerSessionKicked({ reason: 'Session expired or logged in elsewhere' });
        }
      }
    }
  }, []);

  const connect = useCallback(async () => {
    if (socketRef.current?.connected) {
      logger.log('[Socket] Already connected, skipping');
      return;
    }

    // Reset kicked flag on fresh connect (user logged in again)
    isSessionKickedRef.current = false;

    // Clean up existing socket if it exists but isn't connected
    // This prevents duplicate sockets when reconnecting
    if (socketRef.current) {
      logger.log('[Socket] Cleaning up existing disconnected socket');
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    try {
      const token = await authService.getAccessToken();
      if (!token) {
        logger.log('[Socket] No token available for socket connection');
        return;
      }

      lastUsedTokenRef.current = token;
      const socketUrl = config.wsUrl;
      logger.log('[Socket] Connecting to:', socketUrl);
      logger.log('[Socket] Using token:', token.substring(0, 20) + '...');

      socketRef.current = io(socketUrl, {
        path: '/socket.io',
        auth: (cb) => {
          // Dynamic callback — fetches fresh token on each reconnect attempt
          authService.getAccessToken().then((freshToken) => {
            cb({ token: freshToken || token });
          }).catch(() => {
            cb({ token }); // Fall back to original token
          });
        },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      socketRef.current.on('connect', async () => {
        logger.log('[Socket] Connected successfully:', socketRef.current?.id);
        setIsConnected(true);

        // Join device room for device-specific events
        try {
          const deviceId = await getDeviceId();
          if (deviceId && socketRef.current) {
            logger.log('[Socket] Joining device room:', deviceId);
            socketRef.current.emit('join:device', deviceId);
          }
        } catch (err) {
          logger.error('[Socket] Failed to join device room:', err);
        }

        // Log all rooms we should be in
        logger.log('[Socket DEBUG] Socket connected and ready to receive events');
      });

      socketRef.current.on('disconnect', (reason) => {
        logger.log('[Socket] Disconnected:', reason);
        setIsConnected(false);
      });

      // Listen for session kicked event (user logged in on another device)
      socketRef.current.on(SocketEvents.SESSION_KICKED, (data: any) => {
        logger.log('[Socket] Received SESSION_KICKED event:', data);
        // Immediately prevent any reconnect/refresh attempts
        isSessionKickedRef.current = true;
        if (socketRef.current) {
          socketRef.current.io.opts.reconnection = false;
          socketRef.current.removeAllListeners();
          socketRef.current.disconnect();
          socketRef.current = null;
          setIsConnected(false);
        }
        if (triggerSessionKicked) {
          triggerSessionKicked(data);
        }
      });

      // Log reconnection attempts
      socketRef.current.io.on('reconnect_attempt', (attempt) => {
        logger.log(`[Socket] Reconnection attempt ${attempt}...`);
      });

      socketRef.current.io.on('reconnect', async (attempt) => {
        if (isSessionKickedRef.current) return;
        logger.log(`[Socket] Reconnected after ${attempt} attempts`);
        // Verify session is still valid after reconnect
        await verifySession();
      });

      socketRef.current.io.on('reconnect_error', (error) => {
        logger.error('[Socket] Reconnection error:', error.message);
      });

      socketRef.current.io.on('reconnect_failed', () => {
        logger.error('[Socket] Reconnection failed after all attempts');
      });

      socketRef.current.on('connect_error', async (error) => {
        logger.error('[Socket] Connection error:', error.message);
        setIsConnected(false);

        // Don't attempt anything if we were kicked
        if (isSessionKickedRef.current) return;

        // If the error is "Invalid token", stop auto-reconnect and try to refresh
        if (error.message === 'Invalid token' && !isRefreshingRef.current) {
          logger.log('[Socket] Invalid token error - stopping auto-reconnect and attempting refresh...');
          isRefreshingRef.current = true;

          // Stop automatic reconnection to prevent spam
          if (socketRef.current) {
            socketRef.current.io.opts.reconnection = false;
            socketRef.current.disconnect();
          }

          // Wait for API client's refresh to complete, then reconnect
          setTimeout(async () => {
            try {
              // Check if API client already refreshed the token while we waited
              const currentToken = await authService.getAccessToken();
              if (currentToken && currentToken !== lastUsedTokenRef.current) {
                logger.log('[Socket] API client already refreshed token, reconnecting...');
                socketRef.current = null;
                isRefreshingRef.current = false;
                connect();
                return;
              }

              // Token hasn't changed — refresh ourselves
              logger.log('[Socket] Token not refreshed yet, attempting refresh...');
              const newTokens = await authService.refreshTokens();

              if (newTokens) {
                const token = await authService.getAccessToken();
                if (token) {
                  logger.log('[Socket] Got fresh token, reconnecting...');
                  socketRef.current = null;
                  isRefreshingRef.current = false;
                  connect();
                  return;
                }
              }

              // Refresh failed - trigger session kicked to log user out
              logger.log('[Socket] Token refresh failed - triggering session kicked');
              isRefreshingRef.current = false;
              if (triggerSessionKicked) {
                triggerSessionKicked({ reason: 'Session expired - please log in again' });
              }
            } catch (err) {
              logger.error('[Socket] Error refreshing token:', err);
              isRefreshingRef.current = false;
              // Trigger session kicked on error
              if (triggerSessionKicked) {
                triggerSessionKicked({ reason: 'Session expired - please log in again' });
              }
            }
          }, 1000); // Short delay to let any in-flight refresh complete
        }
      });

      // Set up listeners for all registered events
      listenersRef.current.forEach((callbacks, event) => {
        callbacks.forEach((callback) => {
          socketRef.current?.on(event, callback);
        });
      });

      // Debug: Log ALL order-related events
      const orderEvents = [
        SocketEvents.ORDER_CREATED,
        SocketEvents.ORDER_UPDATED,
        SocketEvents.ORDER_COMPLETED,
        SocketEvents.ORDER_DELETED,
      ];
      orderEvents.forEach((eventName) => {
        socketRef.current?.on(eventName, (data: any) => {
          logger.log(`[Socket DEBUG] Received ${eventName}:`, JSON.stringify(data, null, 2));
        });
      });

      // Debug: Log ALL preorder-related events
      const preorderEvents = [
        SocketEvents.PREORDER_CREATED,
        SocketEvents.PREORDER_UPDATED,
        SocketEvents.PREORDER_READY,
      ];
      preorderEvents.forEach((eventName) => {
        socketRef.current?.on(eventName, (data: any) => {
          logger.log(`[Socket DEBUG] Received ${eventName}:`, JSON.stringify(data, null, 2));
        });
      });
    } catch (error) {
      logger.error('[Socket] Failed to connect socket:', error);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      logger.log('[Socket] Disconnecting socket');
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    }
    // Clear all registered listeners when disconnecting
    listenersRef.current.clear();
  }, []);

  // Connect/disconnect based on auth state
  useEffect(() => {
    if (isAuthenticated) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [isAuthenticated, connect, disconnect]);

  // Handle app state changes (reconnect when app comes to foreground)
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      logger.log('[Socket] App state changed to:', nextAppState);
      if (nextAppState === 'active' && isAuthenticated && !isSessionKickedRef.current) {
        // Always verify session when coming back to foreground
        await verifySession();

        if (!socketRef.current?.connected && !isSessionKickedRef.current) {
          logger.log('[Socket] App became active, reconnecting...');
          connect();
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [isAuthenticated, connect, verifySession]);

  // Handle network connectivity changes (verify session when coming back online)
  // This is critical for single-session enforcement when Device 1 loses wifi,
  // Device 2 logs in, then Device 1 comes back online
  useEffect(() => {
    let wasOffline = false;

    const unsubscribe = NetInfo.addEventListener(async (state) => {
      const isOnline = state.isConnected && state.isInternetReachable !== false;

      if (!isOnline) {
        // Track that we were offline
        wasOffline = true;
        logger.log('[Socket] Network went offline');
      } else if (wasOffline && isOnline && isAuthenticated && !isSessionKickedRef.current) {
        // Coming back online after being offline - verify session immediately
        logger.log('[Socket] Network restored - verifying session...');
        wasOffline = false;

        // Verify session first (this will kick us out if another device logged in)
        await verifySession();

        // If still authenticated and socket not connected, reconnect
        if (!socketRef.current?.connected) {
          logger.log('[Socket] Network restored - reconnecting socket...');
          connect();
        }
      }
    });

    return () => unsubscribe();
  }, [isAuthenticated, connect, verifySession]);

  const subscribe = useCallback((event: SocketEventName, callback: EventCallback) => {
    // Add to listeners map
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(callback);

    // If socket is connected, add listener immediately
    if (socketRef.current?.connected) {
      socketRef.current.on(event, callback);
    }

    // Return unsubscribe function
    return () => {
      listenersRef.current.get(event)?.delete(callback);
      socketRef.current?.off(event, callback);
    };
  }, []);

  const emit = useCallback((event: string, data: any) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, data);
    }
  }, []);

  const value = useMemo(() => ({ isConnected, subscribe, emit }), [isConnected, subscribe, emit]);

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): SocketContextType {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}

// Hook to subscribe to socket events with automatic cleanup
export function useSocketEvent(event: SocketEventName, callback: EventCallback) {
  const { subscribe } = useSocket();

  useEffect(() => {
    const unsubscribe = subscribe(event, callback);
    return unsubscribe;
  }, [event, callback, subscribe]);
}
