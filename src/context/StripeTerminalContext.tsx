/**
 * Stripe Terminal Context
 * Provides access to Stripe Terminal SDK for Tap to Pay on iPhone functionality
 * Uses the official @stripe/stripe-terminal-react-native package
 *
 * Apple TTPOi Requirements Compliance:
 * - 1.1: Device compatibility check (iPhone XS+ / A12 chip)
 * - 1.3: iOS version check (17.6+ required, handle osVersionNotSupported)
 * - 1.4: Terminal preparation/warming at app launch
 * - 3.9.1: Configuration progress indicator support
 */

import React, { createContext, useContext, useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { Platform, Alert, AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Conditionally import expo-device (safe for Expo Go)
let Device: typeof import('expo-device') | null = null;
try {
  Device = require('expo-device');
} catch {
  Device = null;
}

import { stripeTerminalApi } from '../lib/api';
import { useAuth } from './AuthContext';
import { useDevice } from './DeviceContext';
import logger from '../lib/logger';

// Check if running in Expo Go (which doesn't support native modules)
const isExpoGo = Constants.appOwnership === 'expo';

// Conditionally import Terminal SDK only on native platforms with dev builds
let StripeTerminalProvider: any = null;
let useStripeTerminal: any = null;
let requestNeededAndroidPermissions: any = null;
let terminalLoadError: string | null = null;

// Only attempt to load the native module if NOT in Expo Go and NOT on web
if (Platform.OS !== 'web' && !isExpoGo) {
  try {
    const terminal = require('@stripe/stripe-terminal-react-native');
    // Verify the module loaded correctly by checking for required exports
    if (terminal && terminal.StripeTerminalProvider && terminal.useStripeTerminal) {
      StripeTerminalProvider = terminal.StripeTerminalProvider;
      useStripeTerminal = terminal.useStripeTerminal;
      requestNeededAndroidPermissions = terminal.requestNeededAndroidPermissions;
    } else {
      terminalLoadError = 'Stripe Terminal module loaded but exports are missing.';
      logger.warn('[StripeTerminal]', terminalLoadError);
    }
  } catch (error: any) {
    terminalLoadError = `Stripe Terminal native module error: ${error?.message || error}`;
    logger.warn('[StripeTerminal] Failed to load terminal SDK:', error);
  }
} else if (isExpoGo) {
  terminalLoadError = 'Stripe Terminal is not available in Expo Go. Please use a development build (eas build --profile development).';
  logger.log('[StripeTerminal] Skipping native module load - running in Expo Go');
}

// Device compatibility check for Tap to Pay on iPhone (requires iPhone XS or later / A12 chip)
// List of compatible device model identifiers (iPhone XS and later)
const TTP_COMPATIBLE_IPHONE_MODELS = [
  // iPhone XS family (A12)
  'iPhone11,2', // iPhone XS
  'iPhone11,4', 'iPhone11,6', // iPhone XS Max
  'iPhone11,8', // iPhone XR
  // iPhone 11 family (A13)
  'iPhone12,1', // iPhone 11
  'iPhone12,3', // iPhone 11 Pro
  'iPhone12,5', // iPhone 11 Pro Max
  // iPhone SE 2nd gen (A13)
  'iPhone12,8',
  // iPhone 12 family (A14)
  'iPhone13,1', // iPhone 12 mini
  'iPhone13,2', // iPhone 12
  'iPhone13,3', // iPhone 12 Pro
  'iPhone13,4', // iPhone 12 Pro Max
  // iPhone 13 family (A15)
  'iPhone14,4', // iPhone 13 mini
  'iPhone14,5', // iPhone 13
  'iPhone14,2', // iPhone 13 Pro
  'iPhone14,3', // iPhone 13 Pro Max
  // iPhone SE 3rd gen (A15)
  'iPhone14,6',
  // iPhone 14 family (A15/A16)
  'iPhone14,7', // iPhone 14
  'iPhone14,8', // iPhone 14 Plus
  'iPhone15,2', // iPhone 14 Pro
  'iPhone15,3', // iPhone 14 Pro Max
  // iPhone 15 family (A16/A17)
  'iPhone15,4', // iPhone 15
  'iPhone15,5', // iPhone 15 Plus
  'iPhone16,1', // iPhone 15 Pro
  'iPhone16,2', // iPhone 15 Pro Max
  // iPhone 16 family (A18)
  'iPhone17,1', 'iPhone17,2', 'iPhone17,3', 'iPhone17,4', 'iPhone17,5',
];

// Minimum iOS version for Tap to Pay on iPhone (16.4 per Stripe Terminal SDK)
// Note: If Apple requires a higher version, the SDK will return osVersionNotSupported error
const MIN_IOS_VERSION = 16.4;

// Configuration progress stages
export type ConfigurationStage =
  | 'idle'
  | 'checking_compatibility'
  | 'initializing'
  | 'fetching_location'
  | 'discovering_reader'
  | 'connecting_reader'
  | 'ready'
  | 'error';

// Types
interface DeviceCompatibility {
  isCompatible: boolean;
  iosVersionSupported: boolean;
  deviceSupported: boolean;
  iosVersion: string | null;
  deviceModel: string | null;
  errorMessage: string | null;
}

// Terms & Conditions acceptance status (retrieved from Apple via SDK, not stored locally)
// Apple TTPOi Requirement: T&C status must be retrieved from Apple, not cached locally
export interface TermsAcceptanceStatus {
  accepted: boolean;
  // Whether we've checked the status (to differentiate between "not accepted" and "not yet checked")
  checked: boolean;
  // If terms need to be accepted, this message can guide the user
  message: string | null;
}

export type DiscoveryMethodType = 'tapToPay' | 'bluetoothScan';

// Preferred reader — persisted in AsyncStorage so the user's selection survives app restarts
const PREFERRED_READER_KEY = 'rowie_preferred_reader';

export interface PreferredReader {
  id: string;           // Stripe reader ID (registered readers) or serialNumber (Bluetooth)
  label: string | null;
  deviceType: string;   // e.g. 'stripe_m2', 'bbpos_wisepos_e', 'stripe_s700'
  readerType: 'bluetooth' | 'internet';
}

// Smart/internet readers use server-driven payments; Bluetooth readers use SDK
const INTERNET_READER_TYPES = ['bbpos_wisepos_e', 'stripe_s700', 'stripe_s710', 'verifone_p400', 'verifone_v660p', 'verifone_ux700', 'verifone_p630', 'verifone_m425', 'simulated_wisepos_e', 'simulated_stripe_s700'];
const BLUETOOTH_READER_TYPES = ['stripe_m2', 'bbpos_wisepad3', 'bbpos_chipper2x'];

export function classifyReaderType(deviceType: string): 'bluetooth' | 'internet' {
  if (BLUETOOTH_READER_TYPES.includes(deviceType)) return 'bluetooth';
  return 'internet';
}

// Terminal payment result from Socket.IO (for server-driven payments)
export interface TerminalPaymentResult {
  status: 'succeeded' | 'failed';
  paymentIntentId: string;
  error?: string;
}

interface StripeTerminalContextValue {
  isInitialized: boolean;
  isConnected: boolean;
  isProcessing: boolean;
  isWarming: boolean;
  error: string | null;
  deviceCompatibility: DeviceCompatibility;
  configurationStage: ConfigurationStage;
  configurationProgress: number; // 0-100
  readerUpdateProgress: number | null; // 0-100 when updating, null otherwise
  termsAcceptance: TermsAcceptanceStatus;
  connectedReaderType: DiscoveryMethodType | null;
  connectedReaderLabel: string | null;
  bluetoothReaders: any[]; // Discovered Bluetooth readers during scan
  isScanning: boolean; // Whether a Bluetooth scan is in progress
  preferredReader: PreferredReader | null;
  terminalPaymentResult: TerminalPaymentResult | null;
  initializeTerminal: () => Promise<void>;
  connectReader: (discoveryMethod?: DiscoveryMethodType, selectedReader?: any) => Promise<boolean>;
  disconnectReader: () => Promise<void>;
  scanForBluetoothReaders: () => Promise<any[]>;
  processPayment: (clientSecret: string) => Promise<{ status: string; paymentIntent: any }>;
  processSetupIntent: (clientSecret: string) => Promise<{ status: string; paymentMethodId: string; setupIntentId: string }>;
  processServerDrivenPayment: (readerId: string, paymentIntentId: string) => Promise<void>;
  cancelPayment: () => Promise<void>;
  warmTerminal: () => Promise<void>;
  waitForWarm: () => Promise<void>;
  checkDeviceCompatibility: () => DeviceCompatibility;
  setPreferredReader: (reader: PreferredReader) => Promise<void>;
  clearPreferredReader: () => Promise<void>;
  clearTerminalPaymentResult: () => void;
  setTerminalPaymentResult: (result: TerminalPaymentResult) => void;
}

export const StripeTerminalContext = createContext<StripeTerminalContextValue | undefined>(undefined);

// Helper function to check device compatibility
function checkDeviceCompatibilitySync(): DeviceCompatibility {
  if (Platform.OS !== 'ios') {
    // Android has different requirements (NFC support)
    return {
      isCompatible: true, // Android compatibility checked via NFC at runtime
      iosVersionSupported: true,
      deviceSupported: true,
      iosVersion: null,
      deviceModel: Device?.modelId || null,
      errorMessage: null,
    };
  }

  const osVersion = Device?.osVersion || null;
  const modelId = Device?.modelId || null;

  // Parse iOS version
  const iosVersionNum = osVersion ? parseFloat(osVersion) : 0;
  const iosVersionSupported = iosVersionNum >= MIN_IOS_VERSION;

  // Check device model
  const deviceSupported = modelId ? TTP_COMPATIBLE_IPHONE_MODELS.some(m => modelId.startsWith(m.split(',')[0])) : false;

  // Also accept if model ID starts with iPhone1[1-9] or higher (future-proofing)
  const modelMatch = modelId?.match(/iPhone(\d+),/);
  const modelNum = modelMatch ? parseInt(modelMatch[1], 10) : 0;
  const isFutureModel = modelNum >= 11; // iPhone XS starts at iPhone11,x

  const isDeviceSupported = deviceSupported || isFutureModel;

  let errorMessage: string | null = null;
  if (!iosVersionSupported) {
    errorMessage = `Tap to Pay on iPhone requires iOS ${MIN_IOS_VERSION} or later. Your device is running iOS ${osVersion}.`;
  } else if (!isDeviceSupported) {
    errorMessage = 'Tap to Pay on iPhone requires iPhone XS or later. Your device is not supported.';
  }

  return {
    isCompatible: iosVersionSupported && isDeviceSupported,
    iosVersionSupported,
    deviceSupported: isDeviceSupported,
    iosVersion: osVersion,
    deviceModel: modelId,
    errorMessage,
  };
}

// Inner component that uses the useStripeTerminal hook
function StripeTerminalInner({ children }: { children: React.ReactNode }) {
  // Get Stripe Connect status and user data to check payment readiness and device registration
  const { connectStatus, isPaymentReady, user } = useAuth();
  const { deviceId } = useDevice();
  const chargesEnabled = connectStatus?.chargesEnabled ?? false;

  // Check if this device has completed TTP education (registered for Tap to Pay)
  const deviceRegisteredForTTP = !!(
    deviceId &&
    user?.tapToPayDeviceIds &&
    user.tapToPayDeviceIds.includes(deviceId)
  );

  const [isInitialized, setIsInitialized] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isWarming, setIsWarming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [deviceCompatibility, setDeviceCompatibility] = useState<DeviceCompatibility>(() => checkDeviceCompatibilitySync());
  const [configurationStage, setConfigurationStage] = useState<ConfigurationStage>('idle');
  const [configurationProgress, setConfigurationProgress] = useState(0);
  const [readerUpdateProgress, setReaderUpdateProgress] = useState<number | null>(null);
  const [connectedReaderType, setConnectedReaderType] = useState<DiscoveryMethodType | null>(null);
  const [connectedReaderLabel, setConnectedReaderLabel] = useState<string | null>(null);
  const [bluetoothReaders, setBluetoothReaders] = useState<any[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [preferredReader, setPreferredReaderState] = useState<PreferredReader | null>(null);
  const [preferredReaderLoaded, setPreferredReaderLoaded] = useState(false);
  const [terminalPaymentResult, setTerminalPaymentResult] = useState<TerminalPaymentResult | null>(null);
  // Terms & Conditions acceptance status - retrieved from Apple via SDK (not stored locally)
  // Apple TTPOi Requirement: Always check T&C status from SDK, never cache locally
  const [termsAcceptance, setTermsAcceptance] = useState<TermsAcceptanceStatus>({
    accepted: false,
    checked: false,
    message: null,
  });

  // Track if we've already warmed the terminal
  const hasWarmedRef = useRef(false);
  const warmPromiseRef = useRef<Promise<void> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const connectingPromiseRef = useRef<Promise<boolean> | null>(null);

  // Use ref to store discovered readers (avoids closure issues with state)
  const discoveredReadersRef = useRef<any[]>([]);

  // Use the official hook - discoveredReaders is provided by the hook
  const {
    initialize,
    discoverReaders,
    discoveredReaders: hookDiscoveredReaders,
    connectReader: sdkConnectReader,
    disconnectReader: sdkDisconnectReader,
    retrievePaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
    retrieveSetupIntent,
    collectSetupIntentPaymentMethod,
    confirmSetupIntent,
    cancelCollectPaymentMethod,
    cancelCollectSetupIntent,
    cancelDiscovering,
    connectedReader: sdkConnectedReader,
  } = useStripeTerminal({
    onUpdateDiscoveredReaders: (readers: any[]) => {
      logger.log('[StripeTerminal] Discovered readers via callback:', readers.length);
      if (readers.length > 0) {
        logger.log('[StripeTerminal] Reader details:', JSON.stringify(readers[0], null, 2));
      }
      discoveredReadersRef.current = readers;
    },
    onDidChangeConnectionStatus: (status: string) => {
      logger.log('[StripeTerminal] Connection status changed:', status);
      setIsConnected(status === 'connected');
    },
    onDidStartInstallingUpdate: (update: any) => {
      logger.log('[StripeTerminal] Started installing update:', update);
      setReaderUpdateProgress(0);
      setConfigurationStage('connecting_reader');
    },
    onDidReportReaderSoftwareUpdateProgress: (progress: number) => {
      // Progress is 0.0 to 1.0, convert to percentage
      const percentage = Math.round(progress * 100);
      logger.log('[StripeTerminal] Reader update progress:', percentage + '%');
      setReaderUpdateProgress(percentage);
      setConfigurationProgress(percentage);
    },
    onDidFinishInstallingUpdate: (update: any, error: any) => {
      logger.log('[StripeTerminal] Finished installing update:', update, error);
      setReaderUpdateProgress(null);
      if (!error) {
        setConfigurationProgress(100);
      }
    },
  });

  // Sync isConnected with SDK's connectedReader state
  // This catches auto-reconnects that don't fire onDidChangeConnectionStatus
  useEffect(() => {
    const sdkHasReader = !!sdkConnectedReader;
    if (sdkHasReader !== isConnected) {
      logger.log('[StripeTerminal] Syncing isConnected from SDK connectedReader:', sdkHasReader);
      setIsConnected(sdkHasReader);
    }
  }, [sdkConnectedReader, isConnected]);

  // Request Android permissions on mount
  useEffect(() => {
    if (Platform.OS === 'android' && requestNeededAndroidPermissions) {
      requestNeededAndroidPermissions({
        accessFineLocation: {
          title: 'Location Permission',
          message: 'Stripe Terminal requires location access for payments.',
          buttonPositive: 'Allow',
        },
      }).catch((err: any) => {
        logger.warn('[StripeTerminal] Permission request failed:', err);
      });
    }
  }, []);

  // Check device compatibility function (exposed to context)
  const checkDeviceCompatibility = useCallback((): DeviceCompatibility => {
    const result = checkDeviceCompatibilitySync();
    setDeviceCompatibility(result);
    return result;
  }, []);

  // Warm the terminal - initialize SDK and prepare for payments (Apple TTPOi 1.4)
  // This should be called at app launch and when returning to foreground
  const warmTerminal = useCallback(async () => {
    logger.log('[StripeTerminal] ========== WARMING TERMINAL ==========');

    // Check device compatibility first
    const compatibility = checkDeviceCompatibilitySync();
    setDeviceCompatibility(compatibility);

    if (!compatibility.isCompatible && Platform.OS === 'ios') {
      logger.log('[StripeTerminal] Device not compatible for TTP:', compatibility.errorMessage);
      setError(compatibility.errorMessage);
      setConfigurationStage('error');
      return;
    }

    if (isInitialized) {
      logger.log('[StripeTerminal] Already initialized, skipping warm');
      return;
    }

    setIsWarming(true);
    setConfigurationStage('checking_compatibility');
    setConfigurationProgress(10);

    try {
      // Step 1: Initialize the SDK
      setConfigurationStage('initializing');
      setConfigurationProgress(30);
      logger.log('[StripeTerminal] Warming: Initializing SDK...');

      const initResult = await initialize();

      if (initResult.error) {
        // Handle osVersionNotSupported error (Apple TTPOi 1.3)
        if (initResult.error.code === 'osVersionNotSupported' ||
            initResult.error.message?.includes('osVersionNotSupported') ||
            initResult.error.message?.includes('OS version')) {
          logger.error('[StripeTerminal] iOS version not supported for TTP');
          const errorMsg = `Tap to Pay on iPhone requires iOS ${MIN_IOS_VERSION} or later. Please update your device.`;
          setError(errorMsg);
          setDeviceCompatibility(prev => ({
            ...prev,
            isCompatible: false,
            iosVersionSupported: false,
            errorMessage: errorMsg,
          }));
          setConfigurationStage('error');
          return;
        }
        throw new Error(initResult.error.message || initResult.error.code || 'Failed to initialize');
      }

      setIsInitialized(true);
      setConfigurationProgress(50);

      // Step 2: Fetch location in background
      setConfigurationStage('fetching_location');
      setConfigurationProgress(70);
      logger.log('[StripeTerminal] Warming: Fetching location...');

      try {
        const { locationId: locId } = await stripeTerminalApi.getLocation();
        setLocationId(locId);
        logger.log('[StripeTerminal] Warming: Location cached:', locId);
      } catch (locErr: any) {
        logger.warn('[StripeTerminal] Warming: Location fetch failed (non-fatal):', locErr.message);
        // Don't fail warming for location errors - we can fetch later
      }

      setConfigurationStage('ready');
      setConfigurationProgress(100);
      logger.log('[StripeTerminal] ========== WARMING COMPLETE ==========');

    } catch (err: any) {
      logger.error('[StripeTerminal] Warming failed:', err.message);
      setError(err.message || 'Failed to warm terminal');
      setConfigurationStage('error');
    } finally {
      setIsWarming(false);
    }
  }, [initialize, isInitialized]);

  // Location is fetched during warmTerminal() and lazily in connectReader() — no separate fetch needed

  const initializeTerminal = useCallback(async () => {
    logger.log('[StripeTerminal] ========== INITIALIZE START ==========');
    logger.log('[StripeTerminal] isInitialized:', isInitialized);

    if (isInitialized) {
      logger.log('[StripeTerminal] Already initialized, skipping');
      return;
    }

    try {
      logger.log('[StripeTerminal] Calling initialize()...');
      setError(null);

      const initResult = await initialize();
      logger.log('[StripeTerminal] Initialize result:', JSON.stringify(initResult, null, 2));

      if (initResult.error) {
        logger.error('[StripeTerminal] Initialize error:', initResult.error);
        const errMsg = `Init error: ${initResult.error.message || initResult.error.code || 'Unknown'}`;
        setError(errMsg);
        throw new Error(errMsg);
      }

      setIsInitialized(true);
      logger.log('[StripeTerminal] ========== INITIALIZE SUCCESS ==========');
    } catch (err: any) {
      logger.error('[StripeTerminal] ========== INITIALIZE FAILED ==========');
      logger.error('[StripeTerminal] Error:', err);
      logger.error('[StripeTerminal] Message:', err.message);
      setError(err.message || 'Failed to initialize terminal');
      throw err;
    }
  }, [initialize, isInitialized]);

  const connectReader = useCallback(async (discoveryMethod: DiscoveryMethodType = 'tapToPay', selectedReader?: any): Promise<boolean> => {
    if (connectingPromiseRef.current) {
      return connectingPromiseRef.current;
    }

    const doConnect = async (): Promise<boolean> => {
      logger.log('[StripeTerminal] connectReader:', discoveryMethod, selectedReader ? 'selectedReader' : 'auto');
      setError(null);

      // Already connected with the right type? Reuse.
      const sdkType = sdkConnectedReader
        ? (BLUETOOTH_READER_TYPES.includes(sdkConnectedReader.deviceType) ? 'bluetoothScan' : 'tapToPay')
        : null;

      if ((isConnected && connectedReaderType === discoveryMethod) || (sdkConnectedReader && sdkType === discoveryMethod)) {
        logger.log('[StripeTerminal] Already connected with correct type, reusing');
        setIsConnected(true);
        setConnectedReaderType(discoveryMethod);
        setConfigurationStage('ready');
        setConfigurationProgress(100);
        return true;
      }

      // Wrong type connected? Disconnect first.
      if (isConnected || sdkConnectedReader) {
        logger.log('[StripeTerminal] Wrong reader type connected, disconnecting');
        try { await sdkDisconnectReader(); } catch {}
        setIsConnected(false);
        setConnectedReaderType(null);
        setConnectedReaderLabel(null);
      }

      // Ensure location
      setConfigurationStage('fetching_location');
      setConfigurationProgress(10);
      let locId = locationId;
      if (!locId) {
        const resp = await stripeTerminalApi.getLocation();
        locId = resp.locationId;
        setLocationId(locId);
      }

      // Discover reader
      setConfigurationStage('discovering_reader');
      setConfigurationProgress(30);
      let readerToConnect: any;

      if (discoveryMethod === 'bluetoothScan' && selectedReader) {
        // Reader provided from scan screen — connect directly, no re-discovery needed
        readerToConnect = selectedReader;
        logger.log('[StripeTerminal] Using provided reader:', selectedReader.serialNumber || 'unknown');
      } else if (discoveryMethod === 'bluetoothScan') {
        // No specific reader — discover and find preferred or first available
        discoveredReadersRef.current = [];
        const discoverPromise = discoverReaders({ discoveryMethod: 'bluetoothScan', simulated: false });
        discoverPromise.catch(() => {});

        const targetSerial = preferredReader?.id || null;
        for (let i = 0; i < 50; i++) {
          await new Promise(r => setTimeout(r, 200));
          const readers = discoveredReadersRef.current;
          if (readers.length > 0) {
            readerToConnect = targetSerial
              ? (readers.find((r: any) => r.serialNumber === targetSerial) || readers[0])
              : readers[0];
            break;
          }
        }

        if (!readerToConnect) {
          try { await cancelDiscovering(); } catch {}
          const msg = 'No Bluetooth readers found nearby. Make sure your reader is powered on and nearby.';
          setError(msg);
          throw new Error(msg);
        }
      } else {
        // TTP: discovery resolves immediately
        const result = await discoverReaders({ discoveryMethod: 'tapToPay', simulated: false });
        if (result.error) {
          const msg = result.error.message || 'Discovery failed';
          setError(msg);
          throw new Error(msg);
        }

        // Brief poll for readers
        let readers = discoveredReadersRef.current;
        for (let i = 0; i < 15 && readers.length === 0; i++) {
          await new Promise(r => setTimeout(r, 200));
          readers = discoveredReadersRef.current.length > 0 ? discoveredReadersRef.current : (hookDiscoveredReaders || []);
        }
        if (readers.length === 0) {
          const msg = 'No readers found. Ensure NFC is enabled and device supports Tap to Pay.';
          setError(msg);
          throw new Error(msg);
        }
        readerToConnect = readers[0];
      }

      // Connect
      setConfigurationStage('connecting_reader');
      setConfigurationProgress(60);
      logger.log('[StripeTerminal] Connecting to:', readerToConnect.serialNumber || 'unknown');

      const connectResult = await sdkConnectReader({
        reader: readerToConnect,
        locationId: locId,
        discoveryMethod,
      });

      // Clean up Bluetooth discovery after connect attempt
      if (discoveryMethod === 'bluetoothScan') {
        try { await cancelDiscovering(); } catch {}
      }

      if (connectResult.error) {
        const isMerchantBlocked = connectResult.error.code === 'TapToPayReaderMerchantBlocked';
        const msg = isMerchantBlocked
          ? 'Your account has been blocked from Tap to Pay. Please contact support.'
          : (connectResult.error.message || 'Connection failed');
        setError(msg);
        throw new Error(msg);
      }

      const connected = connectResult.reader;
      logger.log('[StripeTerminal] Connected:', connected?.serialNumber || discoveryMethod);

      setIsConnected(true);
      setConnectedReaderType(discoveryMethod);
      setConnectedReaderLabel(connected?.label || connected?.serialNumber || null);
      setConfigurationStage('ready');
      setConfigurationProgress(100);

      // TTP: check terms acceptance
      if (discoveryMethod === 'tapToPay' && connected) {
        setTermsAcceptance({
          accepted: connected.accountOnboarded === true,
          checked: true,
          message: connected.accountOnboarded ? null
            : 'Please accept the Tap to Pay Terms & Conditions to start accepting payments.',
        });
      }

      return true;
    };

    const promise = doConnect().finally(() => {
      connectingPromiseRef.current = null;
    });
    connectingPromiseRef.current = promise;
    return promise;
  }, [discoverReaders, cancelDiscovering, sdkConnectReader, sdkDisconnectReader, locationId, hookDiscoveredReaders, isConnected, connectedReaderType, sdkConnectedReader, preferredReader]);

  // Auto-warm terminal on mount and when app comes to foreground (Apple TTPOi 1.4)
  // Only warm if Stripe Connect is set up (chargesEnabled)
  // Respects preferred reader: Bluetooth → connect to it; Internet → skip SDK connect; None → Tap to Pay
  useEffect(() => {
    // Skip warming if Stripe Connect isn't set up yet
    if (!chargesEnabled) {
      logger.log('[StripeTerminal] Skipping auto-warm - Stripe Connect not set up (chargesEnabled=false)');
      return;
    }

    // Wait for preferred reader to load from AsyncStorage before warming,
    // otherwise we don't know whether to connect TTP or Bluetooth
    if (!preferredReaderLoaded) {
      logger.log('[StripeTerminal] Waiting for preferred reader to load from storage before warming...');
      return;
    }

    // Initial warm on mount — initialize SDK, fetch location, then pre-connect reader
    if (!hasWarmedRef.current && deviceCompatibility.isCompatible) {
      logger.log('[StripeTerminal] Auto-warming on mount...');
      hasWarmedRef.current = true;

      const warmPromise = warmTerminal().then(async () => {
        // Determine pre-connect strategy based on preferred reader
        if (preferredReader?.readerType === 'internet') {
          // Internet/smart reader: no SDK connection needed (server-driven payments)
          logger.log('[StripeTerminal] Preferred reader is internet-connected — skipping SDK pre-connect');
          setConfigurationStage('ready');
          setConfigurationProgress(100);
          return;
        }

        if (preferredReader?.readerType === 'bluetooth') {
          // Bluetooth reader: try to discover and connect to the preferred reader
          // Do NOT fall back to TTP — the payment flow will handle Bluetooth connection directly
          logger.log('[StripeTerminal] Preferred reader is Bluetooth — attempting auto-connect:', preferredReader.label || preferredReader.id);
          try {
            await connectReader('bluetoothScan');
            logger.log('[StripeTerminal] Bluetooth reader pre-connected successfully');
          } catch (btErr: any) {
            logger.warn('[StripeTerminal] Bluetooth auto-connect failed (will retry at payment time):', btErr.message);
          }
          return;
        }

        // Default: Tap to Pay pre-connect
        // Only pre-connect if device is already registered for TTP (or on Android).
        // New iOS users must go through TapToPayEducation first.
        const shouldPreConnect = Platform.OS === 'android' || deviceRegisteredForTTP;
        if (shouldPreConnect) {
          try {
            logger.log('[StripeTerminal] Pre-connecting reader after warm (Tap to Pay)...');
            await connectReader();
            logger.log('[StripeTerminal] Reader pre-connected successfully');
          } catch (readerErr: any) {
            logger.warn('[StripeTerminal] Reader pre-connect failed (non-fatal):', readerErr.message);
          }
        } else {
          logger.log('[StripeTerminal] Skipping pre-connect — device not registered for TTP yet');
        }
      }).catch(err => {
        logger.error('[StripeTerminal] Auto-warm failed:', err);
        // Reset so warm can retry (e.g. new account where Stripe isn't ready yet)
        hasWarmedRef.current = false;
      });
      warmPromiseRef.current = warmPromise;
    }

    // Listen for app state changes to re-warm when coming to foreground
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        logger.log('[StripeTerminal] App came to foreground, checking terminal state...');
        // Re-warm if not initialized (connection may have been lost)
        if (!isInitialized && chargesEnabled) {
          warmTerminal().catch(err => {
            logger.error('[StripeTerminal] Re-warm on foreground failed:', err);
          });
        }
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [warmTerminal, connectReader, deviceCompatibility.isCompatible, isInitialized, chargesEnabled, preferredReader, preferredReaderLoaded]);

  // Android auto-connect is handled by the auto-warm effect above

  // Disconnect from the currently connected reader
  const disconnectReader = useCallback(async () => {
    logger.log('[StripeTerminal] Disconnecting reader...');
    try {
      await sdkDisconnectReader();
      setIsConnected(false);
      setConnectedReaderType(null);
      setConnectedReaderLabel(null);
      setConfigurationStage('idle');
      setConfigurationProgress(0);
      logger.log('[StripeTerminal] Reader disconnected');
    } catch (err: any) {
      logger.warn('[StripeTerminal] Disconnect failed:', err.message);
      // Force state reset even if SDK call fails
      setIsConnected(false);
      setConnectedReaderType(null);
      setConnectedReaderLabel(null);
    }
  }, [sdkDisconnectReader]);

  // Load preferred reader from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(PREFERRED_READER_KEY).then(json => {
      if (json) {
        try {
          const reader = JSON.parse(json) as PreferredReader;
          setPreferredReaderState(reader);
          logger.log('[StripeTerminal] Loaded preferred reader:', reader.label || reader.id, '(' + reader.readerType + ')');
        } catch {
          logger.warn('[StripeTerminal] Failed to parse preferred reader from storage');
        }
      }
      setPreferredReaderLoaded(true);
    }).catch(() => {
      setPreferredReaderLoaded(true);
    });
  }, []);

  // Save preferred reader to state + AsyncStorage
  const setPreferredReader = useCallback(async (reader: PreferredReader) => {
    setPreferredReaderState(reader);
    try {
      await AsyncStorage.setItem(PREFERRED_READER_KEY, JSON.stringify(reader));
      logger.log('[StripeTerminal] Saved preferred reader:', reader.label || reader.id);
    } catch (err: any) {
      logger.error('[StripeTerminal] Failed to save preferred reader:', err.message);
    }
  }, []);

  // Clear preferred reader from state + AsyncStorage
  const clearPreferredReader = useCallback(async () => {
    setPreferredReaderState(null);
    try {
      await AsyncStorage.removeItem(PREFERRED_READER_KEY);
      logger.log('[StripeTerminal] Cleared preferred reader');
    } catch (err: any) {
      logger.error('[StripeTerminal] Failed to clear preferred reader:', err.message);
    }
  }, []);

  // Clear terminal payment result (called after PaymentProcessingScreen handles it)
  const clearTerminalPaymentResult = useCallback(() => {
    setTerminalPaymentResult(null);
  }, []);

  // Process a server-driven payment through a smart/internet reader
  const processServerDrivenPayment = useCallback(async (readerId: string, paymentIntentId: string) => {
    logger.log('[StripeTerminal] ========== SERVER-DRIVEN PAYMENT START ==========');
    logger.log('[StripeTerminal] Reader ID:', readerId);
    logger.log('[StripeTerminal] PaymentIntent ID:', paymentIntentId);

    // Clear any previous result
    setTerminalPaymentResult(null);

    // Send the existing PaymentIntent to the reader via API
    const result = await stripeTerminalApi.processPayment(readerId, { paymentIntentId });
    logger.log('[StripeTerminal] Payment sent to reader, action status:', result.actionStatus);

    // The actual payment completion comes via Socket.IO events
    // PaymentProcessingScreen will watch terminalPaymentResult for the outcome
  }, []);

  // Scan for nearby Bluetooth readers (returns discovered readers list)
  const scanForBluetoothReaders = useCallback(async (): Promise<any[]> => {
    logger.log('[StripeTerminal] ========== BLUETOOTH SCAN START ==========');
    setIsScanning(true);
    setBluetoothReaders([]);
    discoveredReadersRef.current = [];

    try {
      // Ensure SDK is initialized
      if (!isInitialized) {
        logger.log('[StripeTerminal] SDK not initialized, initializing for BT scan...');
        const initResult = await initialize();
        if (initResult.error) {
          throw new Error(initResult.error.message || 'Failed to initialize');
        }
        setIsInitialized(true);
      }

      // Start discovery WITHOUT awaiting — bluetoothScan runs continuously
      // and only resolves when cancelled, so awaiting would block forever.
      const discoverPromise = discoverReaders({
        discoveryMethod: 'bluetoothScan',
        simulated: false,
      });

      // Check for immediate errors (e.g. SDK not ready)
      let discoveryErrored = false;
      discoverPromise.then((result: { error?: { message?: string } }) => {
        if (result.error) {
          logger.error('[StripeTerminal] Discovery error:', result.error);
          discoveryErrored = true;
        }
      }).catch((err: Error) => {
        logger.error('[StripeTerminal] Discovery promise rejected:', err);
        discoveryErrored = true;
      });

      // Poll for readers via onUpdateDiscoveredReaders callback (max ~15s)
      let readers: any[] = [];
      for (let i = 0; i < 75; i++) {
        if (discoveryErrored) break;
        await new Promise(resolve => setTimeout(resolve, 200));
        readers = discoveredReadersRef.current.length > 0
          ? discoveredReadersRef.current
          : (hookDiscoveredReaders || []);
        if (readers.length > 0) break;
      }

      // Don't cancel discovery — keep it active so reader objects stay valid
      // for connectReader. Discovery is cancelled after successful connection.
      logger.log('[StripeTerminal] Bluetooth scan found:', readers.length, 'readers');
      setBluetoothReaders(readers);
      return readers;
    } catch (err: any) {
      // Use the stashed connection token error if available (Stripe SDK replaces it with a generic message)
      const realMessage = lastConnectionTokenError || err.message;
      logger.error('[StripeTerminal] Bluetooth scan failed:', realMessage);
      setError(realMessage);
      const errorToThrow = new Error(realMessage);
      lastConnectionTokenError = null;
      throw errorToThrow;
    } finally {
      setIsScanning(false);
    }
  }, [discoverReaders, cancelDiscovering, hookDiscoveredReaders, isInitialized, initialize]);

  const processPayment = useCallback(async (clientSecret: string) => {
    logger.log('[StripeTerminal] ========== PROCESS PAYMENT START ==========');
    logger.log('[StripeTerminal] Client secret provided:', clientSecret ? 'yes' : 'no');

    try {
      setIsProcessing(true);
      setError(null);

      // Step 1: Retrieve the payment intent using client secret
      // NOTE: The Terminal SDK's retrievePaymentIntent requires the client_secret, NOT the PI ID
      logger.log('[StripeTerminal] Step 1: Retrieving payment intent...');
      const { paymentIntent, error: retrieveError } = await retrievePaymentIntent(clientSecret);

      if (retrieveError) {
        logger.error('[StripeTerminal] Retrieve error:', retrieveError);
        throw new Error(retrieveError.message || 'Failed to retrieve payment intent');
      }

      logger.log('[StripeTerminal] Payment intent retrieved successfully');
      logger.log('[StripeTerminal] Amount:', paymentIntent?.amount);
      logger.log('[StripeTerminal] Status:', paymentIntent?.status);

      // Step 2: Collect payment method (shows Tap to Pay UI)
      logger.log('[StripeTerminal] Step 2: Collecting payment method (Tap to Pay UI)...');
      const { paymentIntent: collectedIntent, error: collectError } = await collectPaymentMethod({
        paymentIntent,
      });

      if (collectError) {
        logger.error('[StripeTerminal] Collect error:', collectError);
        throw new Error(collectError.message || 'Failed to collect payment method');
      }

      logger.log('[StripeTerminal] Payment method collected successfully');

      // Step 3: Confirm the payment
      logger.log('[StripeTerminal] Step 3: Confirming payment...');
      const { paymentIntent: confirmedIntent, error: confirmError } = await confirmPaymentIntent({
        paymentIntent: collectedIntent,
      });

      if (confirmError) {
        logger.error('[StripeTerminal] Confirm error:', confirmError);
        throw new Error(confirmError.message || 'Failed to confirm payment');
      }

      logger.log('[StripeTerminal] ========== PAYMENT SUCCESS ==========');
      logger.log('[StripeTerminal] Final status:', confirmedIntent?.status);

      return {
        status: confirmedIntent?.status || 'unknown',
        paymentIntent: confirmedIntent,
      };
    } catch (err: any) {
      logger.error('[StripeTerminal] ========== PAYMENT FAILED ==========');
      logger.error('[StripeTerminal] Error:', err.message);
      setError(err.message || 'Payment failed');
      throw err;
    } finally {
      setIsProcessing(false);
    }
  }, [retrievePaymentIntent, collectPaymentMethod, confirmPaymentIntent]);

  const processSetupIntent = useCallback(async (clientSecret: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      logger.log('[StripeTerminal] ========== SETUP INTENT START ==========');

      // 1. Retrieve the setup intent
      const { setupIntent, error: retrieveError } = await retrieveSetupIntent(clientSecret);
      if (retrieveError || !setupIntent) {
        throw new Error(retrieveError?.message || 'Failed to retrieve setup intent');
      }
      logger.log('[StripeTerminal] SetupIntent retrieved:', setupIntent.id);

      // 2. Collect payment method via Tap to Pay
      const { setupIntent: collectedIntent, error: collectError } = await collectSetupIntentPaymentMethod({
        setupIntent,
        customerConsentCollected: true,
      });
      if (collectError || !collectedIntent) {
        throw new Error(collectError?.message || 'Failed to collect payment method');
      }
      logger.log('[StripeTerminal] Payment method collected');

      // 3. Confirm the setup intent
      const { setupIntent: confirmedIntent, error: confirmError } = await confirmSetupIntent({
        setupIntent: collectedIntent,
      });
      if (confirmError || !confirmedIntent) {
        throw new Error(confirmError?.message || 'Failed to confirm setup intent');
      }
      logger.log('[StripeTerminal] SetupIntent confirmed:', confirmedIntent.id);

      const paymentMethodId = (confirmedIntent as any).paymentMethodId || (confirmedIntent as any).payment_method || '';
      if (!paymentMethodId) {
        throw new Error('No payment method ID returned from setup intent');
      }

      return {
        status: confirmedIntent.status || 'succeeded',
        paymentMethodId,
        setupIntentId: confirmedIntent.id,
      };
    } catch (err: any) {
      logger.error('[StripeTerminal] ========== SETUP INTENT FAILED ==========');
      logger.error('[StripeTerminal] Error:', err.message);
      setError(err.message || 'Tab setup failed');
      throw err;
    } finally {
      setIsProcessing(false);
    }
  }, [retrieveSetupIntent, collectSetupIntentPaymentMethod, confirmSetupIntent]);

  const cancelPayment = useCallback(async () => {
    try {
      logger.log('[StripeTerminal] Cancelling payment...');
      await cancelCollectPaymentMethod();
      logger.log('[StripeTerminal] Payment cancelled');
    } catch (err: any) {
      logger.warn('[StripeTerminal] Cancel failed:', err);
      // Don't throw - cancellation errors are not critical
    }
  }, [cancelCollectPaymentMethod]);

  // Wait for the background warm (SDK init + reader pre-connect) to complete
  const waitForWarm = useCallback(async () => {
    if (warmPromiseRef.current) {
      await warmPromiseRef.current;
    }
  }, []);

  const value = useMemo<StripeTerminalContextValue>(() => ({
    isInitialized,
    isConnected,
    isProcessing,
    isWarming,
    error,
    deviceCompatibility,
    configurationStage,
    configurationProgress,
    readerUpdateProgress,
    termsAcceptance,
    connectedReaderType,
    connectedReaderLabel,
    bluetoothReaders,
    isScanning,
    preferredReader,
    terminalPaymentResult,
    initializeTerminal,
    connectReader,
    disconnectReader,
    scanForBluetoothReaders,
    processPayment,
    processSetupIntent,
    processServerDrivenPayment,
    cancelPayment,
    warmTerminal,
    waitForWarm,
    checkDeviceCompatibility,
    setPreferredReader,
    clearPreferredReader,
    clearTerminalPaymentResult,
    setTerminalPaymentResult,
  }), [isInitialized, isConnected, isProcessing, isWarming, error, deviceCompatibility, configurationStage, configurationProgress, readerUpdateProgress, termsAcceptance, connectedReaderType, connectedReaderLabel, bluetoothReaders, isScanning, preferredReader, terminalPaymentResult, initializeTerminal, connectReader, disconnectReader, scanForBluetoothReaders, processPayment, processSetupIntent, processServerDrivenPayment, cancelPayment, warmTerminal, waitForWarm, checkDeviceCompatibility, setPreferredReader, clearPreferredReader, clearTerminalPaymentResult]);

  return (
    <StripeTerminalContext.Provider value={value}>
      {children}
    </StripeTerminalContext.Provider>
  );
}

// Token provider function for StripeTerminalProvider
// Stores the last connection token error so we can surface it in the UI
// (the Stripe SDK replaces our error with a generic message)
let lastConnectionTokenError: string | null = null;

async function fetchConnectionToken(): Promise<string> {
  logger.log('[StripeTerminal] Fetching connection token...');
  lastConnectionTokenError = null;
  try {
    const { secret } = await stripeTerminalApi.getConnectionToken();
    logger.log('[StripeTerminal] Connection token received');
    return secret;
  } catch (error: any) {
    logger.error('[StripeTerminal] Failed to get connection token:', error);

    const errorMessage = error?.message?.toLowerCase() || '';
    const statusCode = error?.statusCode;

    if (
      errorMessage.includes('connect') ||
      errorMessage.includes('account') ||
      errorMessage.includes('charges_enabled') ||
      errorMessage.includes('not found') ||
      statusCode === 400 ||
      statusCode === 403
    ) {
      lastConnectionTokenError = 'Payment processing is not set up yet. Please complete Stripe Connect onboarding in Settings to accept payments.';
    } else {
      lastConnectionTokenError = error?.message || 'Failed to connect to payment service. Please try again.';
    }

    throw new Error(lastConnectionTokenError || 'Failed to connect to payment service');
  }
}

// Main provider component
// Note: Stripe Tap to Pay UI automatically follows the system dark mode setting on Android
// For iOS, the SDK respects the app's UIUserInterfaceStyle
export function StripeTerminalContextProvider({ children }: { children: React.ReactNode }) {
  // On web or when native module isn't available (Expo Go), provide a stub context
  if (Platform.OS === 'web' || !StripeTerminalProvider) {
    const isWeb = Platform.OS === 'web';
    const errorMessage = isWeb
      ? 'Stripe Terminal is not available on web'
      : terminalLoadError || 'Stripe Terminal requires a development build. Expo Go does not include native modules.';

    const stubValue: StripeTerminalContextValue = {
      isInitialized: false,
      isConnected: false,
      isProcessing: false,
      isWarming: false,
      error: errorMessage,
      deviceCompatibility: {
        isCompatible: false,
        iosVersionSupported: false,
        deviceSupported: false,
        iosVersion: null,
        deviceModel: null,
        errorMessage,
      },
      configurationStage: 'error',
      configurationProgress: 0,
      readerUpdateProgress: null,
      termsAcceptance: {
        accepted: false,
        checked: false,
        message: errorMessage,
      },
      connectedReaderType: null,
      connectedReaderLabel: null,
      bluetoothReaders: [],
      isScanning: false,
      preferredReader: null,
      terminalPaymentResult: null,
      initializeTerminal: async () => {
        throw new Error(errorMessage);
      },
      connectReader: async () => false,
      disconnectReader: async () => {},
      scanForBluetoothReaders: async () => [],
      processPayment: async () => {
        throw new Error(errorMessage);
      },
      processSetupIntent: async () => {
        throw new Error(errorMessage);
      },
      processServerDrivenPayment: async () => {},
      cancelPayment: async () => {},
      warmTerminal: async () => {
        throw new Error(errorMessage);
      },
      waitForWarm: async () => {},
      checkDeviceCompatibility: () => ({
        isCompatible: false,
        iosVersionSupported: false,
        deviceSupported: false,
        iosVersion: null,
        deviceModel: null,
        errorMessage,
      }),
      setPreferredReader: async () => {},
      clearPreferredReader: async () => {},
      clearTerminalPaymentResult: () => {},
      setTerminalPaymentResult: () => {},
    };

    return (
      <StripeTerminalContext.Provider value={stubValue}>
        {children}
      </StripeTerminalContext.Provider>
    );
  }

  // On native, wrap with the official provider with dark mode colors
  return (
    <StripeTerminalProvider
      tokenProvider={fetchConnectionToken}
      logLevel="verbose"
    >
      <StripeTerminalInner>{children}</StripeTerminalInner>
    </StripeTerminalProvider>
  );
}

// Hook to access terminal functionality
export function useTerminal() {
  const context = useContext(StripeTerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within a StripeTerminalContextProvider');
  }
  return context;
}
