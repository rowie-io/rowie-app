import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';

const DEVICE_ID_KEY = 'rowie_device_id';

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get or create a unique device ID
 * This ID persists across app updates but not reinstalls
 */
export async function getDeviceId(): Promise<string> {
  try {
    // Check if we already have a device ID stored
    let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);

    if (!deviceId) {
      // Generate a new device ID
      deviceId = generateUUID();
      await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
    }

    return deviceId;
  } catch (error) {
    // Fallback to a session-based ID if storage fails
    return generateUUID();
  }
}

/**
 * Get device info for display purposes
 */
export function getDeviceInfo(): { name: string; model: string; os: string } {
  return {
    name: Device.deviceName || 'Unknown Device',
    model: Device.modelName || 'Unknown Model',
    os: `${Device.osName || 'Unknown'} ${Device.osVersion || ''}`.trim(),
  };
}

/**
 * Get detailed device info for API transmission
 */
export function getDeviceInfoForApi(): {
  name: string;
  model: string;
  os: string;
  osVersion: string;
} {
  return {
    name: Device.deviceName || 'Unknown Device',
    model: Device.modelName || 'Unknown Model',
    os: Device.osName || 'Unknown',
    osVersion: Device.osVersion || '',
  };
}

/**
 * Get a friendly device name (e.g., "iPhone 14 Pro" or "Pixel 7")
 */
export function getDeviceName(): string {
  if (Device.deviceName) {
    return Device.deviceName;
  }
  if (Device.modelName) {
    return Device.modelName;
  }
  return 'Unknown Device';
}
