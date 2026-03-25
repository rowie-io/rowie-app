import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Catalog, catalogsApi } from '../lib/api';
import { useAuth } from './AuthContext';
import { useSocket, useSocketEvent, SocketEvents } from './SocketContext';
import logger from '../lib/logger';

interface CatalogContextType {
  selectedCatalog: Catalog | null;
  catalogs: Catalog[];
  isLoading: boolean;
  setSelectedCatalog: (catalog: Catalog) => Promise<void>;
  clearCatalog: () => Promise<void>;
  refreshCatalogs: () => Promise<void>;
}

const CatalogContext = createContext<CatalogContextType | undefined>(undefined);

const CATALOG_STORAGE_KEY = 'selected_catalog';

interface CatalogProviderProps {
  children: ReactNode;
}

export function CatalogProvider({ children }: CatalogProviderProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [selectedCatalog, setSelectedCatalogState] = useState<Catalog | null>(null);
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasFetched, setHasFetched] = useState(false);

  // Load cached catalog (for selectedCatalog) - but don't stop loading until catalogs list is fetched
  const loadCachedCatalog = useCallback(async () => {
    try {
      const savedCatalogJson = await AsyncStorage.getItem(CATALOG_STORAGE_KEY);
      if (savedCatalogJson) {
        const savedCatalog = JSON.parse(savedCatalogJson) as Catalog;
        setSelectedCatalogState(savedCatalog);
        // Return true to indicate we have a cached catalog, but keep isLoading=true
        // until the full catalogs list is fetched (so MenuScreen doesn't show "no catalogs" prematurely)
        return true;
      }
    } catch (error) {
      logger.error('Failed to load cached menus:', error);
    }
    return false;
  }, []);

  // Fetch catalogs from API and validate/update selection
  const fetchAndValidateCatalogs = useCallback(async (hadCachedData: boolean) => {
    try {
      const fetchedCatalogs = await catalogsApi.list();
      logger.log('[CatalogContext] Fetched catalogs:', fetchedCatalogs.map(c => ({ id: c.id, name: c.name, isLocked: c.isLocked, createdAt: c.createdAt })));
      setCatalogs(fetchedCatalogs);

      // Filter to only unlocked, active catalogs for auto-selection
      const availableCatalogs = fetchedCatalogs.filter(c => c.isActive && !c.isLocked);
      logger.log('[CatalogContext] Available (unlocked) catalogs:', availableCatalogs.map(c => ({ id: c.id, name: c.name })));

      // Get current selected catalog (might have been loaded from cache)
      const savedCatalogJson = await AsyncStorage.getItem(CATALOG_STORAGE_KEY);
      const savedCatalog = savedCatalogJson ? JSON.parse(savedCatalogJson) as Catalog : null;
      logger.log('[CatalogContext] Saved catalog from storage:', savedCatalog ? { id: savedCatalog.id, name: savedCatalog.name } : null);

      if (savedCatalog) {
        // Verify saved catalog still exists and is not locked
        const stillExists = fetchedCatalogs.find(c => c.id === savedCatalog.id);
        logger.log('[CatalogContext] Saved catalog still exists?', !!stillExists, 'isLocked?', stillExists?.isLocked);
        if (stillExists && !stillExists.isLocked) {
          // Use the fresh data from API in case name/details changed
          logger.log('[CatalogContext] Keeping saved catalog (not locked):', stillExists.name);
          setSelectedCatalogState(stillExists);
          await AsyncStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(stillExists));
        } else if (availableCatalogs.length > 0) {
          // Saved catalog no longer exists or is locked, select first available
          logger.log('[CatalogContext] Saved catalog is locked/missing, switching to:', availableCatalogs[0].name);
          setSelectedCatalogState(availableCatalogs[0]);
          await AsyncStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(availableCatalogs[0]));
        } else {
          // No catalogs available, clear selection
          logger.log('[CatalogContext] No available catalogs, clearing selection');
          setSelectedCatalogState(null);
          await AsyncStorage.removeItem(CATALOG_STORAGE_KEY);
        }
      } else if (availableCatalogs.length > 0) {
        // No saved catalog, auto-select the first available one
        logger.log('[CatalogContext] No saved catalog, auto-selecting:', availableCatalogs[0].name);
        setSelectedCatalogState(availableCatalogs[0]);
        await AsyncStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(availableCatalogs[0]));
      }
    } catch (error) {
      logger.error('Failed to fetch catalogs:', error);
      // Keep using cached catalog if API fails
    } finally {
      // Always set loading false after fetch completes (or fails)
      setIsLoading(false);
      setHasFetched(true);
    }
  }, []);

  // Load cached catalog immediately when authenticated, then validate with API
  useEffect(() => {
    if (!authLoading && isAuthenticated && !hasFetched) {
      // Ensure loading is true when starting fetch
      setIsLoading(true);
      // First load from cache (instant), then fetch from API
      // Note: isLoading stays true until catalogs list is fetched
      loadCachedCatalog().then((hadCachedData) => {
        fetchAndValidateCatalogs(hadCachedData);
      });
    } else if (!authLoading && !isAuthenticated) {
      // Not authenticated, stop loading
      setIsLoading(false);
    }
  }, [authLoading, isAuthenticated, hasFetched, loadCachedCatalog, fetchAndValidateCatalogs]);

  // Reset when user logs out
  useEffect(() => {
    if (!isAuthenticated && hasFetched) {
      setSelectedCatalogState(null);
      setCatalogs([]);
      setHasFetched(false);
      setIsLoading(true);
    }
  }, [isAuthenticated, hasFetched]);

  const setSelectedCatalog = useCallback(async (catalog: Catalog) => {
    setSelectedCatalogState(catalog);
    try {
      await AsyncStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalog));
    } catch (error) {
      logger.error('Failed to save catalog:', error);
    }
  }, []);

  const clearCatalog = useCallback(async () => {
    setSelectedCatalogState(null);
    try {
      await AsyncStorage.removeItem(CATALOG_STORAGE_KEY);
    } catch (error) {
      logger.error('Failed to clear catalog:', error);
    }
  }, []);

  // Use ref to avoid dependency on selectedCatalog which changes and causes re-subscriptions
  const selectedCatalogRef = useRef<Catalog | null>(null);
  selectedCatalogRef.current = selectedCatalog;

  const refreshCatalogs = useCallback(async () => {
    try {
      const fetchedCatalogs = await catalogsApi.list();
      setCatalogs(fetchedCatalogs);

      // Filter to only unlocked, active catalogs for auto-selection
      const availableCatalogs = fetchedCatalogs.filter(c => c.isActive && !c.isLocked);

      // Update selected catalog if it was updated (use ref to avoid dependency cycle)
      const currentSelected = selectedCatalogRef.current;
      if (currentSelected) {
        const updated = fetchedCatalogs.find(c => c.id === currentSelected.id);
        if (updated && !updated.isLocked) {
          // Current catalog still exists and is not locked
          setSelectedCatalogState(updated);
          await AsyncStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(updated));
        } else if (availableCatalogs.length > 0) {
          // Current catalog is locked or deleted, switch to first available
          setSelectedCatalogState(availableCatalogs[0]);
          await AsyncStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(availableCatalogs[0]));
        } else {
          // No available catalogs
          setSelectedCatalogState(null);
          await AsyncStorage.removeItem(CATALOG_STORAGE_KEY);
        }
      } else if (availableCatalogs.length > 0) {
        // No catalog selected, auto-select the first available one
        logger.log('[CatalogContext] No catalog selected, auto-selecting:', availableCatalogs[0].name);
        setSelectedCatalogState(availableCatalogs[0]);
        await AsyncStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(availableCatalogs[0]));
      }
    } catch (error) {
      logger.error('Failed to refresh catalogs:', error);
    }
  }, []);

  // Listen for socket events to refresh catalogs in real-time
  const handleCatalogUpdate = useCallback((data?: { catalogId?: string }) => {
    if (isAuthenticated) {
      // Immediately refresh catalogs when any catalog changes
      refreshCatalogs();
    }
  }, [isAuthenticated, refreshCatalogs]);

  const handleCatalogDelete = useCallback(async (data?: { catalogId?: string }) => {
    if (isAuthenticated) {
      // Refresh catalogs first to get the updated list
      try {
        const fetchedCatalogs = await catalogsApi.list();
        setCatalogs(fetchedCatalogs);

        // Filter to only unlocked, active catalogs for auto-selection
        const availableCatalogs = fetchedCatalogs.filter(c => c.isActive && !c.isLocked);

        // If the deleted catalog was selected, auto-select the first available one (use ref)
        const currentSelected = selectedCatalogRef.current;
        if (data?.catalogId && currentSelected?.id === data.catalogId) {
          if (availableCatalogs.length > 0) {
            setSelectedCatalogState(availableCatalogs[0]);
            await AsyncStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(availableCatalogs[0]));
          } else {
            setSelectedCatalogState(null);
            await AsyncStorage.removeItem(CATALOG_STORAGE_KEY);
          }
        }
      } catch (error) {
        logger.error('Failed to handle catalog deletion:', error);
      }
    }
  }, [isAuthenticated]);

  useSocketEvent(SocketEvents.CATALOG_UPDATED, handleCatalogUpdate);
  useSocketEvent(SocketEvents.CATALOG_CREATED, handleCatalogUpdate);
  useSocketEvent(SocketEvents.CATALOG_DELETED, handleCatalogDelete);

  // Refresh catalogs on socket REconnect (not initial connection)
  const { isConnected } = useSocket();
  const wasConnectedRef = useRef(isConnected);
  const hasEverConnectedRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current && hasEverConnectedRef.current && isAuthenticated) {
      logger.log('[CatalogContext] Socket reconnected, refreshing catalogs');
      refreshCatalogs();
    }
    if (isConnected) hasEverConnectedRef.current = true;
    wasConnectedRef.current = isConnected;
  }, [isConnected, isAuthenticated, refreshCatalogs]);

  const value = useMemo(() => ({
    selectedCatalog,
    catalogs,
    isLoading,
    setSelectedCatalog,
    clearCatalog,
    refreshCatalogs,
  }), [selectedCatalog, catalogs, isLoading, setSelectedCatalog, clearCatalog, refreshCatalogs]);

  return (
    <CatalogContext.Provider value={value}>
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog(): CatalogContextType {
  const context = useContext(CatalogContext);
  if (!context) {
    throw new Error('useCatalog must be used within a CatalogProvider');
  }
  return context;
}
