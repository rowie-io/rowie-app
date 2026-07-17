/**
 * Shared NetInfo wiring — single source of truth for "is the device online".
 * Used by the NetworkStatus banner and by charge entry points (tab-bar Charge
 * action, Menu quick-charge FAB, Checkout pay button) to disable payments
 * while offline.
 */

import { useEffect, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export interface NetworkStatusState {
  /** null = unknown (initial fetch pending) */
  isConnected: boolean | null;
  /** true only when we positively know the device is offline */
  isOffline: boolean;
}

function resolveConnected(state: NetInfoState): boolean {
  return !!state.isConnected && state.isInternetReachable !== false;
}

export function useNetworkStatus(): NetworkStatusState {
  const [isConnected, setIsConnected] = useState<boolean | null>(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setIsConnected(resolveConnected(state));
    });

    // Check initial state
    NetInfo.fetch().then((state) => {
      setIsConnected(resolveConnected(state));
    });

    return () => unsubscribe();
  }, []);

  return { isConnected, isOffline: isConnected === false };
}
