/**
 * Tap to Pay Education Screen
 * Apple TTPOi Requirements:
 * - 3.5: Clear action to trigger T&C acceptance (Enable button)
 * - 3.9.1: Configuration progress indicator
 *
 * iOS: Shows enable screen, then Apple's native ProximityReaderDiscovery education UI.
 * Android: Auto-enables and navigates back (no education required by Google).
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useDevice } from '../context/DeviceContext';
import { authService } from '../lib/api';
import { useTranslations } from '../lib/i18n';

import { useTheme } from '../context/ThemeContext';
import { useTerminal, ConfigurationStage } from '../context/StripeTerminalContext';
import { shadows } from '../lib/shadows';
import { spacing, radius } from '../lib/spacing';
import logger from '../lib/logger';

// Apple TTPOi 5.4: Region-correct copy
const TAP_TO_PAY_NAME = Platform.OS === 'ios' ? 'Tap to Pay on iPhone' : 'Tap to Pay';

// Configuration stage messages mapped to i18n keys (Apple TTPOi 3.9.1)
const STAGE_MESSAGE_KEYS: Record<ConfigurationStage, string> = {
  idle: 'educationStageIdle',
  checking_compatibility: 'educationStageCheckingCompatibility',
  initializing: 'educationStageInitializing',
  fetching_location: 'educationStageFetchingLocation',
  discovering_reader: 'educationStageDiscoveringReader',
  connecting_reader: 'educationStageConnectingReader',
  ready: 'educationStageReady',
  error: 'educationStageError',
};




export function TapToPayEducationScreen() {
  const { colors, isDark } = useTheme();
  const t = useTranslations('tapToPay');
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  // Auth context for user ID and device context for device ID
  const { user, refreshAuth } = useAuth();
  const { deviceId } = useDevice();

  // Check if this device has already completed Tap to Pay setup
  const deviceAlreadyRegistered = !!(
    deviceId &&
    user?.tapToPayDeviceIds &&
    user.tapToPayDeviceIds.includes(deviceId)
  );

  logger.log('[TapToPayEducation] Device check:', {
    deviceId,
    tapToPayDeviceIds: user?.tapToPayDeviceIds,
    deviceAlreadyRegistered,
  });

  // Terminal context for enabling Tap to Pay
  const {
    deviceCompatibility,
    configurationStage,
    configurationProgress,
    connectReader,
    initializeTerminal,
    waitForWarm,
    isInitialized,
    isConnected,
    isWarming,
    error: terminalError,
  } = useTerminal();

  // Platform-specific behavior:
  // - iOS 18+: Use ProximityReaderDiscovery for Apple's native education UI
  // - iOS 16-17: Use custom education slides
  // - Android: Skip education entirely (not required by Google)
  const isAndroid = Platform.OS === 'android';
  const isIOS = Platform.OS === 'ios';

  // Check if ProximityReaderDiscovery is available (iOS 18+)
  const [proximityDiscoveryAvailable, setProximityDiscoveryAvailable] = useState<boolean | null>(null);
  const [appleEducationActive, setAppleEducationActive] = useState(false);
  const educationCompleteRef = useRef(false);

  useEffect(() => {
    if (isIOS) {
      // Dynamically import to avoid loading native module on Android/Expo Go
      import('../lib/native/ProximityReaderDiscovery')
        .then(module => module.isProximityReaderDiscoveryAvailable())
        .then((available) => {
          logger.log('[TapToPayEducation] ProximityReaderDiscovery available:', available);
          setProximityDiscoveryAvailable(available);
        })
        .catch((err) => {
          logger.log('[TapToPayEducation] ProximityReaderDiscovery check failed:', err);
          setProximityDiscoveryAvailable(false);
        });
    } else {
      setProximityDiscoveryAvailable(false);
    }
  }, [isIOS]);

  // iOS 18+: Use ProximityReaderDiscovery for Apple's native education UI
  const useAppleNativeEducation = isIOS && proximityDiscoveryAvailable === true;

  useEffect(() => {
    logger.log('[TapToPayEducation] State:', {
      isIOS, isAndroid, isConnected, isInitialized,
      proximityDiscoveryAvailable, appleEducationActive,
    });
  }, [isIOS, isAndroid, isConnected, isInitialized, proximityDiscoveryAvailable, appleEducationActive]);

  // Register this device as having Tap to Pay enabled
  const registerDevice = async () => {
    if (!deviceId) return;
    try {
      const result = await authService.registerTapToPayDevice(deviceId);
      logger.log('[TapToPayEducation] Device registered:', result.tapToPayDeviceIds);
      // Update cached user so next screen mount sees the registration
      if (user) {
        await authService.saveUser({ ...user, tapToPayDeviceIds: result.tapToPayDeviceIds });
      }
    } catch (err) {
      logger.warn('[TapToPayEducation] Failed to register device:', err);
    }
  };

  const [isEnabling, setIsEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const [isConnectSetupError, setIsConnectSetupError] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  const styles = createStyles(colors, isDark);

  const navigateBack = () => {
    // Refresh auth so user state picks up newly registered device IDs
    refreshAuth().catch(() => {});
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      // Onboarding flow (came via replace) — go to main screen
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    }
  };

  // iOS: Once we know ProximityReader availability, handle the flow
  const autoHandledRef = useRef(false);
  useEffect(() => {
    if (!isIOS || educationCompleteRef.current || autoHandledRef.current) return;
    if (proximityDiscoveryAvailable === null) return;

    // Device already registered — auto-handle (show Apple education or navigate back)
    if (deviceAlreadyRegistered) {
      autoHandledRef.current = true;
      if (useAppleNativeEducation) {
        logger.log('[TapToPayEducation] Device registered, auto-connecting for Apple education');
        (async () => {
          try {
            if (!isConnected) {
              await waitForWarm();
              if (!isInitialized) await initializeTerminal();
              await connectReader();
            }
            await showAppleNativeEducation();
          } catch (err: any) {
            logger.warn('[TapToPayEducation] Auto-enable failed:', err.message);
            navigateBack();
          }
        })();
      } else {
        // iOS < 18, no Apple education to show
        navigateBack();
      }
      return;
    }

    // Not registered — show the enable screen (Apple TTPOi 3.5 requires explicit user action)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIOS, isConnected, proximityDiscoveryAvailable, useAppleNativeEducation, deviceAlreadyRegistered]);

  // Android auto-enable on mount: Connect reader and navigate back immediately
  useEffect(() => {
    if (isAndroid) {
      // If already connected, register device and navigate back
      if (isConnected) {
        registerDevice();
        navigateBack();
        return;
      }
      // Otherwise, auto-enable
      if (!isEnabling) {
        handleAndroidAutoEnable();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAndroid, isConnected]);

  const handleAndroidAutoEnable = async () => {
    setIsEnabling(true);
    try {
      await waitForWarm();
      if (!isInitialized) {
        await initializeTerminal();
      }
      const connected = await connectReader();
      if (connected) {
        await registerDevice();
        navigateBack();
      } else {
        setEnableError(t('educationErrorFailedGeneric'));
      }
    } catch (err: any) {
      logger.error('[TapToPayEducation] Android enable failed:', err);
      setEnableError(err.message || t('educationErrorFailedGeneric'));
    } finally {
      setIsEnabling(false);
    }
  };

  // iOS 18+: Show Apple's native education UI after T&C acceptance
  const showAppleNativeEducation = async () => {
    autoHandledRef.current = true;
    setAppleEducationActive(true);
    try {
      const { showProximityReaderDiscoveryEducation } = await import('../lib/native/ProximityReaderDiscovery');
      await showProximityReaderDiscoveryEducation();
    } catch (err: any) {
      logger.warn('[TapToPayEducation] Apple education dismissed or failed:', err);
    }
    // Register device AFTER education completes (not before)
    if (!deviceAlreadyRegistered) {
      logger.log('[TapToPayEducation] Apple education complete, registering device');
      await registerDevice();
    }
    // Mark complete so loading guard doesn't re-show
    educationCompleteRef.current = true;
    setAppleEducationActive(false);
    navigateBack();
  };

  // Check if device is not compatible
  const isDeviceIncompatible = !deviceCompatibility.isCompatible;

  // Handle enable button press - triggers T&C acceptance flow (Apple TTPOi 3.5)
  const handleEnable = async () => {
    // Check device compatibility first
    if (isDeviceIncompatible) {
      setEnableError(
        deviceCompatibility.errorMessage ||
        (Platform.OS === 'ios'
          ? t('educationErrorDeviceIos', { tapToPayName: TAP_TO_PAY_NAME })
          : t('educationErrorDeviceAndroid', { tapToPayName: TAP_TO_PAY_NAME }))
      );
      return;
    }

    setIsEnabling(true);
    setEnableError(null);
    setIsConnectSetupError(false);

    try {
      // Wait for background warm to finish first (avoids race conditions)
      await waitForWarm();

      // Initialize terminal if not already done
      if (!isInitialized) {
        await initializeTerminal();
      }

      // Connect reader - this triggers Apple's T&C acceptance screen
      const connected = await connectReader();

      if (connected) {
        // Show Apple's native education UI after T&C acceptance
        await showAppleNativeEducation();
        return;
      } else {
        setEnableError(t('educationErrorFailedConnect'));
      }
    } catch (err: any) {
      logger.error('[TapToPayEducation] Enable failed:', err);
      const errorMsg = err.message?.toLowerCase() || '';
      const errorCode = err.code?.toLowerCase() || '';

      // Check for ToS cancellation first (user declined Apple's Terms of Service)
      if (
        errorCode.includes('tosacceptancecanceled') ||
        errorMsg.includes('terms of service') ||
        errorMsg.includes('tos acceptance')
      ) {
        // User cancelled ToS - this is not a setup error, just needs retry
        setEnableError(t('educationErrorTosRequired'));
      }
      // Check if this is a Stripe Connect setup error
      else if (
        errorMsg.includes('connection token') ||
        errorMsg.includes('tokenprovider') ||
        errorMsg.includes('payment processing is not set up') ||
        errorMsg.includes('stripe connect') ||
        errorMsg.includes('connected account') ||
        errorMsg.includes('no connected account')
      ) {
        setIsConnectSetupError(true);
        setEnableError(t('educationErrorConnectSetup'));
      } else {
        setEnableError(err.message || t('educationErrorFailedGeneric'));
      }
    } finally {
      setIsEnabling(false);
    }
  };

  // Navigate to Stripe onboarding
  const handleGoToPaymentSetup = () => {
    navigation.navigate('StripeOnboarding');
  };

  const handleClose = () => {
    navigateBack();
  };

  // Determine button text based on current state
  const getButtonText = () => {
    if (isEnabling) return t('educationButtonEnabling');
    // If there's an error, show retry regardless of connection state
    if (enableError) return t('educationButtonTryAgain');
    if (isConnected && deviceAlreadyRegistered) return t('educationButtonContinue');
    return t('educationButtonEnable', { tapToPayName: TAP_TO_PAY_NAME });
  };

  const handleButtonPress = () => {
    if (enableError) {
      // Retry — clear error and re-enable
      handleEnable();
    } else if (isConnected && deviceAlreadyRegistered) {
      // Returning user — device already registered, just show Apple education
      showAppleNativeEducation();
    } else {
      // New user or not connected — go through full enable flow (T&C, progress, etc.)
      handleEnable();
    }
  };

  // Android: Show simple enabling/success UI (no education slides needed)
  if (isAndroid) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose} accessibilityRole="button" accessibilityLabel={t('educationCloseAccessibilityLabel')}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>{t('educationHeaderTitleSettingUp')}</Text>
          <View style={styles.skipButton} />
        </View>
        <View style={styles.androidCenterContent}>
          {isEnabling ? (
            <>
              <View style={styles.progressIconContainer}>
                <View style={styles.progressRing}>
                  <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={t('educationAndroidEnablingTitle')} />
                </View>
              </View>
              <Text style={styles.slideTitle} maxFontSizeMultiplier={1.3}>{t('educationAndroidEnablingTitle')}</Text>
              <Text style={styles.slideDescription} maxFontSizeMultiplier={1.5}>
                {t('educationAndroidEnablingDescription')}
              </Text>
            </>
          ) : enableError ? (
            <>
              {/* Check if this is the Expo Go error */}
              {enableError.includes('Expo Go') ? (
                <>
                  <View style={[styles.errorIconCircle, { backgroundColor: colors.warning + '15' }]}>
                    <Ionicons name="code-slash-outline" size={40} color={colors.warning} />
                  </View>
                  <Text style={styles.slideTitle} maxFontSizeMultiplier={1.3}>{t('educationAndroidDevBuildTitle')}</Text>
                  <Text style={[styles.slideDescription, { marginBottom: 24 }]} maxFontSizeMultiplier={1.5}>
                    {t('educationAndroidDevBuildDescription')}
                  </Text>
                  <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.infoCardTitle, { color: colors.text }]} maxFontSizeMultiplier={1.5}>{t('educationAndroidDevBuildHowTo')}</Text>
                    <Text style={[styles.infoCardText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                      {t('educationAndroidDevBuildCommand', { command: 'eas build --profile development' })}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleClose}
                    activeOpacity={0.9}
                    style={{ marginTop: 32, width: '100%' }}
                    accessibilityRole="button"
                    accessibilityLabel={t('educationAndroidGotIt')}
                  >
                    <View style={[styles.nextButton, { backgroundColor: colors.primary }]}>
                      <Text style={styles.nextButtonText} maxFontSizeMultiplier={1.3}>{t('educationAndroidGotIt')}</Text>
                    </View>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={[styles.errorIconCircle, { backgroundColor: colors.error + '15' }]}>
                    <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
                  </View>
                  <Text style={styles.slideTitle} maxFontSizeMultiplier={1.3}>{t('educationAndroidSetupFailed')}</Text>
                  <Text style={[styles.slideDescription, { marginBottom: 8 }]} maxFontSizeMultiplier={1.5}>{enableError}</Text>
                  <TouchableOpacity
                    onPress={handleAndroidAutoEnable}
                    activeOpacity={0.9}
                    style={{ marginTop: 32, width: '100%' }}
                    accessibilityRole="button"
                    accessibilityLabel={t('educationButtonTryAgain')}
                  >
                    <View style={[styles.nextButton, { backgroundColor: colors.primary }]}>
                      <Text style={styles.nextButtonText} maxFontSizeMultiplier={1.3}>{t('educationButtonTryAgain')}</Text>
                    </View>
                  </TouchableOpacity>
                </>
              )}
            </>
          ) : (
            <>
              <View style={styles.successIconContainer}>
                <Ionicons name="checkmark-circle" size={80} color={colors.success} />
              </View>
              <Text style={styles.slideTitle} maxFontSizeMultiplier={1.3}>{t('educationAndroidReadyTitle')}</Text>
              <Text style={styles.slideDescription} maxFontSizeMultiplier={1.5}>
                {t('educationAndroidReadyDescription')}
              </Text>
            </>
          )}
        </View>
      </View>
    );
  }

  // iOS loading states:
  // - Apple education sheet active → blank screen (native sheet covers it)
  // - Auto-education in progress for registered device → loading spinner
  // - Initial async checks still running → loading spinner
  // For unregistered devices, show the enable screen immediately
  const pendingAutoEducation = isIOS && autoHandledRef.current && !educationCompleteRef.current;
  const showLoadingScreen = appleEducationActive || pendingAutoEducation ||
    (deviceAlreadyRegistered && !educationCompleteRef.current) ||
    (isIOS && proximityDiscoveryAvailable === null);

  // Stop animations after 5s so they don't lag the native Apple education sheet
  useEffect(() => {
    if (showLoadingScreen && !loadingTimedOut) {
      const timer = setTimeout(() => setLoadingTimedOut(true), 5000);
      return () => clearTimeout(timer);
    }
  }, [showLoadingScreen, loadingTimedOut]);

  if (showLoadingScreen) {
    if (loadingTimedOut) {
      return <View style={{ flex: 1, backgroundColor: isDark ? '#1C1917' : colors.background }} />;
    }
    return (
      <View style={{ flex: 1, backgroundColor: isDark ? '#1C1917' : colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isButtonDisabled = isEnabling;

  return (
    <View style={{ flex: 1 }}>
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={handleClose} accessibilityRole="button" accessibilityLabel={t('educationCloseAccessibilityLabel')}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>{t('educationHeaderTitleSetup')}</Text>
        <View style={styles.skipButton} />
      </View>

      {/* Enable Screen */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.slideScrollContent}
        style={styles.slidesContainer}
      >
        {isEnabling ? (
          /* Configuration Progress State - Apple TTPOi 3.9.1 */
          <>
            <View style={styles.progressIconContainer}>
              <View style={styles.progressRing}>
                <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={t('educationHeaderTitleSettingUp')} />
              </View>
            </View>
            <Text style={styles.progressPercent} maxFontSizeMultiplier={1.2} accessibilityRole="text" accessibilityLabel={t('educationProgressAccessibilityLabel', { percent: Math.round(configurationProgress) })}>{Math.round(configurationProgress)}%</Text>
            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBarFill, { width: `${configurationProgress}%`, backgroundColor: colors.primary }]} />
            </View>
            <Text style={styles.slideTitle} maxFontSizeMultiplier={1.3}>{t('educationSettingUp')}</Text>
            <Text style={styles.stageText} maxFontSizeMultiplier={1.5}>
              {t(STAGE_MESSAGE_KEYS[configurationStage] || 'educationPleaseWait')}
            </Text>
            {configurationStage === 'connecting_reader' && (
              <Text style={styles.hintText} maxFontSizeMultiplier={1.5}>
                {t('educationTermsHint')}
              </Text>
            )}
          </>
        ) : (
          /* Initial Enable State */
          <>
            <View style={styles.iconContainer}>
              <View style={[styles.iconGradient, { backgroundColor: colors.primary }]}>
                <Ionicons name="wifi" size={64} color="#fff" style={styles.nfcIcon} />
              </View>
            </View>
            <Text style={styles.slideTitle} maxFontSizeMultiplier={1.3}>{t('educationEnableTitle', { tapToPayName: TAP_TO_PAY_NAME })}</Text>
            <Text style={styles.slideDescription} maxFontSizeMultiplier={1.5}>
              {t('educationEnableDescription')}
            </Text>

            {/* Features list */}
            <View style={styles.tipsContainer}>
              {[
                { icon: 'shield-checkmark', text: t('educationFeatureSecure') },
                { icon: 'card', text: t('educationFeatureCards') },
                { icon: 'flash', text: t('educationFeatureNoHardware') },
              ].map((feature, index) => (
                <View key={index} style={styles.tipRow}>
                  <View style={styles.featureIconBg}>
                    <Ionicons name={feature.icon as any} size={16} color={colors.primary} />
                  </View>
                  <Text style={styles.tipText} maxFontSizeMultiplier={1.5}>{feature.text}</Text>
                </View>
              ))}
            </View>

            {/* Error message — only show errors from user-initiated enable, not background warm */}
            {enableError && (
              <View style={styles.errorContainer} accessibilityRole="alert">
                <View style={styles.errorRow}>
                  <Ionicons name="alert-circle" size={18} color={colors.error} />
                  <Text style={styles.errorText} maxFontSizeMultiplier={1.5}>{enableError}</Text>
                </View>
                {isConnectSetupError && (
                  <TouchableOpacity
                    style={styles.setupPaymentsButton}
                    onPress={handleGoToPaymentSetup}
                    accessibilityRole="button"
                    accessibilityLabel={t('educationSetUpPayments')}
                    accessibilityHint={t('educationSetUpPaymentsAccessibilityHint')}
                  >
                    <Ionicons name="card-outline" size={18} color="#fff" />
                    <Text style={styles.setupPaymentsButtonText} maxFontSizeMultiplier={1.3}>{t('educationSetUpPayments')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handleButtonPress}
          activeOpacity={0.9}
          disabled={isButtonDisabled}
          accessibilityRole="button"
          accessibilityLabel={getButtonText()}
          accessibilityState={{ disabled: isButtonDisabled }}
        >
          <View style={[styles.nextButton, { backgroundColor: isButtonDisabled ? colors.gray600 : colors.primary }, isButtonDisabled && { opacity: 0.6 }]}>
            {isEnabling ? (
              <ActivityIndicator size="small" color="#fff" accessibilityLabel={t('educationButtonEnabling')} />
            ) : (
              <>
                <Text style={styles.nextButtonText} maxFontSizeMultiplier={1.3}>{getButtonText()}</Text>
                {!isConnected && (
                  <Ionicons name="flash" size={20} color="#fff" />
                )}
              </>
            )}
          </View>
        </TouchableOpacity>
      </View>
    </View>
    </View>
  );
}

const createStyles = (colors: any, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
    },
    closeButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
    },
    skipButton: {
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    slidesContainer: {
      flex: 1,
    },
    slideScrollContent: {
      paddingHorizontal: 32,
      paddingTop: 40,
      paddingBottom: 40,
      alignItems: 'center',
    },
    iconContainer: {
      marginBottom: 32,
    },
    iconGradient: {
      width: 120,
      height: 120,
      borderRadius: 30,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.lg,
    },
    errorIconCircle: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
    },
    infoCard: {
      width: '100%',
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
    },
    infoCardTitle: {
      fontSize: 15,
      fontWeight: '600',
      marginBottom: 8,
    },
    infoCardText: {
      fontSize: 14,
      lineHeight: 20,
    },
    slideTitle: {
      fontSize: 28,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 16,
    },
    slideDescription: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 24,
      marginBottom: 32,
    },
    tipsContainer: {
      width: '100%',
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadows.sm,
    },
    tipRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 16,
      gap: 12,
    },
    tipText: {
      flex: 1,
      fontSize: 15,
      color: colors.text,
      lineHeight: 22,
    },
    footer: {
      padding: 20,
      paddingBottom: 32,
    },
    nextButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 18,
      borderRadius: 20,
      gap: 8,
      ...shadows.md,
    },
    nextButtonText: {
      color: '#fff',
      fontSize: 18,
      fontWeight: '600',
    },
    // Enable slide - Progress state styles
    progressIconContainer: {
      marginBottom: spacing.lg,
    },
    progressRing: {
      width: 100,
      height: 100,
      borderRadius: 50,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
      borderWidth: 3,
      borderColor: colors.primary + '30',
    },
    progressPercent: {
      fontSize: 32,
      fontWeight: '700',
      color: colors.primary,
      marginBottom: spacing.md,
    },
    progressBarContainer: {
      width: '80%',
      height: 6,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
      borderRadius: 3,
      overflow: 'hidden',
      marginBottom: spacing.xl,
    },
    progressBarFill: {
      height: '100%',
      borderRadius: 3,
      overflow: 'hidden',
    },
    stageText: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: spacing.sm,
    },
    hintText: {
      fontSize: 14,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: spacing.md,
      fontStyle: 'italic',
    },
    // Enable slide - Success state styles
    successIconContainer: {
      marginBottom: spacing.lg,
    },
    // Enable slide - Initial state styles
    featureIconBg: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      backgroundColor: colors.primary + '15',
      alignItems: 'center',
      justifyContent: 'center',
    },
    nfcIcon: {
      transform: [{ rotate: '90deg' }],
    },
    // Error styles
    errorContainer: {
      flexDirection: 'column',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      backgroundColor: colors.error + '15',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.error + '30',
    },
    errorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    errorText: {
      fontSize: 14,
      color: colors.error,
      textAlign: 'left',
      flex: 1,
    },
    setupPaymentsButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      backgroundColor: colors.primary,
      borderRadius: radius.md,
    },
    setupPaymentsButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: '#fff',
    },
    // Android-specific centered content layout
    androidCenterContent: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
  });
