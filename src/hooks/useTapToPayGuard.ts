/**
 * Hook that guards checkout entry points.
 * If the device hasn't completed Tap to Pay setup (not in user.tapToPayDeviceIds),
 * redirects to TapToPayEducation screen instead of allowing checkout.
 */

import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useDevice } from '../context/DeviceContext';

export function useTapToPayGuard() {
  const navigation = useNavigation<any>();
  const { user, connectStatus } = useAuth();
  const { deviceId } = useDevice();

  const deviceRegistered = !!(
    deviceId &&
    user?.tapToPayDeviceIds &&
    user.tapToPayDeviceIds.includes(deviceId)
  );

  const isConnectSetUp = connectStatus?.chargesEnabled === true;

  /**
   * Call before navigating to Checkout.
   * Returns true if checkout can proceed, false if redirected to TTP education.
   */
  const guardCheckout = useCallback((): boolean => {
    // If Connect isn't set up, other UI guards (SetupRequiredBanner) handle it
    if (!isConnectSetUp) {
      return true;
    }

    // Android: skip education screen — TTP setup is handled silently via auto-warm
    if (Platform.OS === 'android') {
      return true;
    }

    // iOS: Connect is set up but device hasn't completed TTP education
    if (!deviceRegistered) {
      navigation.navigate('TapToPayEducation');
      return false;
    }

    return true;
  }, [isConnectSetUp, deviceRegistered, navigation]);

  return { guardCheckout, deviceRegistered };
}
