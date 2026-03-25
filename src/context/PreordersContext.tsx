import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, ReactNode } from 'react';
import { preordersApi } from '../lib/api/preorders';
import { useSocketEvent, useSocket, SocketEvents } from './SocketContext';
import { useAuth } from './AuthContext';
import { useCatalog } from './CatalogContext';

interface PreorderCounts {
  pending: number;
  preparing: number;
  ready: number;
  total: number;
}

interface PreordersContextType {
  counts: PreorderCounts;
  isLoading: boolean;
  refreshCounts: () => Promise<void>;
}

const PreordersContext = createContext<PreordersContextType | undefined>(undefined);

interface PreordersProviderProps {
  children: ReactNode;
}

export function PreordersProvider({ children }: PreordersProviderProps) {
  const { isAuthenticated, subscription } = useAuth();
  const { isConnected } = useSocket();
  const { selectedCatalog } = useCatalog();
  const isPro = subscription?.tier === 'pro' || subscription?.tier === 'enterprise';
  const wasConnectedRef = useRef(isConnected);
  const hasEverConnectedRef = useRef(false);

  const [counts, setCounts] = useState<PreorderCounts>({
    pending: 0,
    preparing: 0,
    ready: 0,
    total: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  const refreshCounts = useCallback(async () => {
    if (!isAuthenticated || !selectedCatalog || !isPro) return;

    try {
      const stats = await preordersApi.getStats(selectedCatalog.id);
      const newCounts = {
        pending: stats.pending,
        preparing: stats.preparing,
        ready: stats.ready,
        total: stats.pending + stats.preparing + stats.ready,
      };
      setCounts(newCounts);
    } catch (error) {
      // Silently ignore
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, selectedCatalog, isPro]);

  // Refetch when authenticated or selected catalog changes (Pro/Enterprise only)
  useEffect(() => {
    if (isAuthenticated && selectedCatalog && isPro) {
      refreshCounts();
    } else {
      setCounts({ pending: 0, preparing: 0, ready: 0, total: 0 });
      setIsLoading(false);
    }
  }, [isAuthenticated, selectedCatalog, isPro, refreshCounts]);

  // Refetch when socket REconnects (not initial connection)
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current && hasEverConnectedRef.current && isAuthenticated) {
      refreshCounts();
    }
    if (isConnected) hasEverConnectedRef.current = true;
    wasConnectedRef.current = isConnected;
  }, [isConnected, isAuthenticated, refreshCounts]);

  // Listen for preorder events
  const handlePreorderEvent = useCallback((_data: any) => {
    refreshCounts();
  }, [refreshCounts]);

  useSocketEvent(SocketEvents.PREORDER_CREATED, handlePreorderEvent);
  useSocketEvent(SocketEvents.PREORDER_UPDATED, handlePreorderEvent);
  useSocketEvent(SocketEvents.PREORDER_COMPLETED, handlePreorderEvent);
  useSocketEvent(SocketEvents.PREORDER_CANCELLED, handlePreorderEvent);

  const value = useMemo(() => ({ counts, isLoading, refreshCounts }), [counts, isLoading, refreshCounts]);

  return (
    <PreordersContext.Provider value={value}>
      {children}
    </PreordersContext.Provider>
  );
}

export function usePreorders(): PreordersContextType {
  const context = useContext(PreordersContext);
  if (!context) {
    throw new Error('usePreorders must be used within a PreordersProvider');
  }
  return context;
}
