import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { getDeviceId } from '../lib/device';

interface DeviceContextType {
  deviceId: string | null;
  isLoading: boolean;
}

const DeviceContext = createContext<DeviceContextType | undefined>(undefined);

interface DeviceProviderProps {
  children: ReactNode;
}

export function DeviceProvider({ children }: DeviceProviderProps) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadDeviceId() {
      try {
        const id = await getDeviceId();
        setDeviceId(id);
      } catch (error) {
        // Silently ignore
      } finally {
        setIsLoading(false);
      }
    }

    loadDeviceId();
  }, []);

  const value = useMemo(() => ({ deviceId, isLoading }), [deviceId, isLoading]);

  return (
    <DeviceContext.Provider value={value}>
      {children}
    </DeviceContext.Provider>
  );
}

export function useDevice(): DeviceContextType {
  const context = useContext(DeviceContext);
  if (!context) {
    throw new Error('useDevice must be used within a DeviceProvider');
  }
  return context;
}
