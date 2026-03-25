import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import logger from '../logger';

// Try TurboModuleRegistry first (new arch), fallback to NativeModules (old arch)
const ProximityReaderDiscoveryModule =
  TurboModuleRegistry?.get?.('ProximityReaderDiscoveryModule') ||
  NativeModules.ProximityReaderDiscoveryModule;

logger.log('[ProximityReader] Module lookup:', {
  fromTurbo: !!TurboModuleRegistry?.get?.('ProximityReaderDiscoveryModule'),
  fromNativeModules: !!NativeModules.ProximityReaderDiscoveryModule,
  resolved: !!ProximityReaderDiscoveryModule,
  platform: Platform.OS,
});

export async function isProximityReaderDiscoveryAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios' || !ProximityReaderDiscoveryModule) {
    logger.log('[ProximityReader] Not available:', { platform: Platform.OS, hasModule: !!ProximityReaderDiscoveryModule });
    return false;
  }
  try {
    const result = await ProximityReaderDiscoveryModule.isAvailable();
    logger.log('[ProximityReader] isAvailable result:', result);
    return result;
  } catch (err) {
    logger.log('[ProximityReader] isAvailable error:', err);
    return false;
  }
}

export async function showProximityReaderDiscoveryEducation(): Promise<{ success: boolean }> {
  if (!ProximityReaderDiscoveryModule) {
    throw new Error('ProximityReaderDiscovery native module not available');
  }
  return await ProximityReaderDiscoveryModule.showEducation();
}

export async function checkProximityReaderDeviceSupport(): Promise<{ isSupported: boolean; reason?: string }> {
  if (Platform.OS !== 'ios' || !ProximityReaderDiscoveryModule) {
    return { isSupported: false, reason: 'Not available on this platform' };
  }
  try {
    return await ProximityReaderDiscoveryModule.checkDeviceSupport();
  } catch {
    return { isSupported: false, reason: 'Failed to check device support' };
  }
}

export default {
  isAvailable: isProximityReaderDiscoveryAvailable,
  showEducation: showProximityReaderDiscoveryEducation,
  checkDeviceSupport: checkProximityReaderDeviceSupport,
};
