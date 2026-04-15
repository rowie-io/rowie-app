import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCatalog } from '../context/CatalogContext';
import { useDevice } from '../context/DeviceContext';
import { useAuth } from '../context/AuthContext';
import { productsApi, categoriesApi, transactionsApi, ordersApi, sessionsApi, eventsApi } from '../lib/api';
import { billingService } from '../lib/api/billing';
import logger from '../lib/logger';

/**
 * Prefetches data for Settings, Menu, and Transactions screens on app load.
 * Runs once — subsequent updates come via Socket.IO query invalidation.
 */
export function DataPrefetcher() {
  const queryClient = useQueryClient();
  const { selectedCatalog } = useCatalog();
  const { deviceId } = useDevice();
  const { subscription } = useAuth();
  const hasPrefetched = useRef(false);
  const isPro = subscription?.tier === 'pro' || subscription?.tier === 'enterprise';

  useEffect(() => {
    if (hasPrefetched.current) return;
    if (!selectedCatalog?.id || !deviceId) return;

    hasPrefetched.current = true;
    logger.log('[DataPrefetcher] Prefetching data');

    // Settings: subscription info
    queryClient.prefetchQuery({
      queryKey: ['subscription-info'],
      queryFn: () => billingService.getSubscriptionInfo(),
    });

    // Menu: products and categories
    queryClient.prefetchQuery({
      queryKey: ['products', selectedCatalog.id],
      queryFn: () => productsApi.list(selectedCatalog.id),
    });

    queryClient.prefetchQuery({
      queryKey: ['categories', selectedCatalog.id],
      queryFn: () => categoriesApi.list(selectedCatalog.id),
    });

    // Transactions: first page (default 'all' filter)
    queryClient.prefetchInfiniteQuery({
      queryKey: ['transactions', selectedCatalog.id, deviceId, 'all'],
      queryFn: () =>
        transactionsApi.list({
          limit: 25,
          catalog_id: selectedCatalog.id,
          device_id: deviceId,
          status: 'all',
        }),
      initialPageParam: undefined as string | undefined,
    });

    // Held orders
    queryClient.prefetchQuery({
      queryKey: ['held-orders', deviceId],
      queryFn: () => ordersApi.listHeld(deviceId),
    });

    // Sessions: Pro/Enterprise only — prefetch open sessions + tabs
    if (isPro) {
      queryClient.prefetchQuery({
        queryKey: ['sessions', { status: 'open' }],
        queryFn: () => sessionsApi.list({ status: 'open', catalogId: selectedCatalog.id }),
      });
      queryClient.prefetchQuery({
        queryKey: ['sessions', 'tabs'],
        queryFn: () => sessionsApi.listTabs(),
      });
    }

    // Events: prefetch for ticket scanner screen (available to all tiers)
    queryClient.prefetchQuery({
      queryKey: ['events'],
      queryFn: () => eventsApi.list(),
    });
  }, [selectedCatalog?.id, deviceId, queryClient]);

  return null;
}
