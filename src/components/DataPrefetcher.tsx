import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCatalog } from '../context/CatalogContext';
import { useDevice } from '../context/DeviceContext';
import { useAuth } from '../context/AuthContext';
import { productsApi, categoriesApi, transactionsApi, sessionsApi, eventsApi } from '../lib/api';
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
  const { subscription, user } = useAuth();
  const hasPrefetched = useRef(false);
  const isPro = subscription?.tier === 'pro' || subscription?.tier === 'enterprise';
  // /billing/subscription-info is owner/admin-only — prefetching it for staff
  // just produces 403s.
  const canViewBilling = user?.role === 'owner' || user?.role === 'admin';

  useEffect(() => {
    if (hasPrefetched.current) return;
    // Wait for the auth user too — firing before the cached user loads would
    // permanently skip the owner-only billing prefetch (one-shot guard).
    if (!selectedCatalog?.id || !deviceId || !user) return;

    hasPrefetched.current = true;
    logger.log('[DataPrefetcher] Prefetching data');

    // Settings: subscription info (owner/admin only — staff get 403)
    if (canViewBilling) {
      queryClient.prefetchQuery({
        queryKey: ['subscription-info'],
        queryFn: () => billingService.getSubscriptionInfo(),
      });
    }

    // Menu: products and categories
    queryClient.prefetchQuery({
      queryKey: ['products', selectedCatalog.id],
      queryFn: () => productsApi.list(selectedCatalog.id),
    });

    queryClient.prefetchQuery({
      queryKey: ['categories', selectedCatalog.id],
      queryFn: () => categoriesApi.list(selectedCatalog.id),
    });

    // Transactions: first page (default 'all' filter) — key + offset scheme
    // must mirror TransactionsScreen's useInfiniteQuery or the prefetch never
    // matches the screen's cache entry.
    queryClient.prefetchInfiniteQuery({
      queryKey: ['transactions', 'all'],
      queryFn: () => transactionsApi.list({ limit: 25, status: 'all', offset: 0 }),
      initialPageParam: 0,
    });

    // Sessions: Pro/Enterprise only — prefetch open sessions + tabs.
    // The catalog filter MUST be reflected in the query key, otherwise this
    // collides with FloorPlanScreen's `['sessions', { status: 'open' }]`
    // (unfiltered, org-wide) and the last-fetch-wins race silently wipes the
    // canvas's session data depending on response ordering.
    if (isPro) {
      queryClient.prefetchQuery({
        queryKey: ['sessions', { status: 'open', catalogId: selectedCatalog.id }],
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
  }, [selectedCatalog?.id, deviceId, queryClient, user, canViewBilling]);

  return null;
}
