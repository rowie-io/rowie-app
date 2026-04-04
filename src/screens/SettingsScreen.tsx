import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { useTranslations } from '../lib/i18n';
import { LanguagePickerModal } from '../components/LanguagePickerModal';
import { useCatalog } from '../context/CatalogContext';
import { useTerminal } from '../context/StripeTerminalContext';
import { useSocketEvent, SocketEvents } from '../context/SocketContext';
import { authService } from '../lib/api/auth';
import { billingService, SubscriptionInfo } from '../lib/api/billing';
import { Subscription } from '../lib/api';
import { formatCents } from '../utils/currency';
import {
  enableBiometricLogin,
  disableBiometricLogin,
} from '../lib/biometricAuth';

// Apple TTPOi 5.4: Region-correct terminology
const TAP_TO_PAY_NAME = Platform.OS === 'ios' ? 'Tap to Pay on iPhone' : 'Tap to Pay';
import { createVendorDashboardUrl } from '../lib/auth-handoff';
import { config } from '../lib/config';
import { Toggle } from '../components/Toggle';
import { ProfileEditModal } from '../components/ProfileEditModal';
import { fonts } from '../lib/fonts';
import logger from '../lib/logger';

export function SettingsScreen() {
  const { colors, isDark, toggleTheme } = useTheme();
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);

  // Restore scroll position after theme change re-render
  useEffect(() => {
    if (scrollOffsetRef.current > 0) {
      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollTo({ y: scrollOffsetRef.current, animated: false });
      });
    }
  }, [isDark]);
  const { user, organization, subscription, signOut, connectStatus, connectLoading, isPaymentReady, refreshAuth, biometricCapabilities, biometricEnabled, setBiometricEnabled, refreshBiometricStatus, currency } = useAuth();
  const { selectedCatalog, catalogs, clearCatalog } = useCatalog();
  const {
    deviceCompatibility,
    isInitialized,
    isWarming,
    configurationStage,
    configurationProgress,
    readerUpdateProgress,
  } = useTerminal();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  // Listen for subscription updates via socket and refresh data
  const handleSubscriptionUpdated = useCallback((data: any) => {
    logger.log('[SettingsScreen] Received SUBSCRIPTION_UPDATED event:', data);
    // Invalidate and refetch subscription info
    queryClient.invalidateQueries({ queryKey: ['subscription-info'] });
    // Also refresh auth to update subscription in AuthContext
    refreshAuth();
  }, [queryClient, refreshAuth]);

  useSocketEvent(SocketEvents.SUBSCRIPTION_UPDATED, handleSubscriptionUpdated);

  // Fetch detailed billing info for all users - needed to check platform (Stripe vs Apple/Google)
  // and to show appropriate manage subscription options
  const { data: subscriptionInfo, isLoading: subscriptionLoading } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription-info'],
    queryFn: () => billingService.getSubscriptionInfo(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });

  // Check Pro status from both AuthContext (may be stale) and API response (always fresh)
  // subscriptionInfo from API takes precedence since it's fetched fresh
  const tier = subscriptionInfo?.tier || subscription?.tier;
  const status = subscriptionInfo?.status || subscription?.status;
  const isPro = tier === 'pro' || tier === 'enterprise';

  // Check if user signed up via the website (Stripe platform) or has a manual subscription
  // These users are locked out of IAP and should not see in-app purchase options
  // They must manage their subscription via the vendor portal or contact support
  const isStripePlatformUser = subscriptionInfo?.platform === 'stripe' || subscriptionInfo?.platform === 'manual';


  // Profile edit modal
  const [showProfileEdit, setShowProfileEdit] = useState(false);

  // Language picker modal
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const { languageName } = useLanguage();

  // Biometric toggle loading state (values come from AuthContext)
  const [biometricLoading, setBiometricLoading] = useState(false);

  const needsBankingSetup = !connectLoading && !connectStatus?.chargesEnabled && (user?.role === 'owner' || user?.role === 'admin');

  // Refresh biometric status when screen is focused
  useFocusEffect(
    useCallback(() => {
      refreshBiometricStatus();
    }, [refreshBiometricStatus])
  );

  // Handle biometric toggle
  const handleBiometricToggle = async (value: boolean) => {
    logger.log('[SettingsScreen] handleBiometricToggle called, value:', value);

    if (!biometricCapabilities?.isAvailable) {
      logger.log('[SettingsScreen] Biometrics not available, returning');
      return;
    }

    setBiometricLoading(true);

    try {
      if (value) {
        // Enable biometric login (will prompt for biometric auth)
        const success = await enableBiometricLogin();
        if (success) {
          setBiometricEnabled(true);
        }
      } else {
        // Disable biometric login
        await disableBiometricLogin();
        setBiometricEnabled(false);
      }
    } catch (error) {
      logger.error('[SettingsScreen] Error toggling biometric:', error);
      Alert.alert(tc('error'), t('errorBiometricToggle', { action: value ? tc('enable').toLowerCase() : tc('disable').toLowerCase() }));
    } finally {
      setBiometricLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      logger.error('[SettingsScreen] Sign out error:', error);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t('deleteAccountAlertTitle'),
      t('deleteAccountAlertMessage'),
      [
        { text: tc('cancel'), style: 'cancel' },
        {
          text: t('deleteAccountAlertConfirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await authService.requestAccountDeletion();
              const deletionDate = result.deletionDate
                ? new Date(result.deletionDate).toLocaleDateString()
                : '30 days from now';
              Alert.alert(
                t('deleteAccountScheduledTitle'),
                t('deleteAccountScheduledMessage', { deletionDate, email: user?.email || 'your email' }),
                [{ text: tc('ok'), onPress: () => signOut() }]
              );
            } catch (error: any) {
              logger.error('[SettingsScreen] Account deletion request error:', error);
              if (error?.status === 409) {
                Alert.alert(t('deleteAccountAlreadyScheduledTitle'), t('deleteAccountAlreadyScheduledMessage'));
              } else {
                Alert.alert(t('deleteAccountErrorTitle'), t('deleteAccountErrorMessage'));
              }
            }
          },
        },
      ]
    );
  };

  const handleSwitchCatalog = () => {
    navigation.navigate('CatalogSelect');
  };

  const handleOpenVendorPortal = async () => {
    const url = await createVendorDashboardUrl();
    if (url) {
      // Open vendor portal with auth - callback will redirect to home
      Linking.openURL(url);
    } else {
      // Fallback: open without auth
      Linking.openURL(config.vendorDashboardUrl);
    }
  };

  // Subscription management handlers
  const [manageLoading, setManageLoading] = useState(false);

  const handleManageSubscription = async () => {
    if (!subscriptionInfo) return;

    if (subscriptionInfo.platform === 'manual') {
      // Manual subscriptions are managed by Rowie — no external link
      Alert.alert(t('managedByRowieAlertTitle'), t('managedByRowieAlert'));
      return;
    } else if (subscriptionInfo.platform === 'apple') {
      // Open iOS App Store subscription management
      Linking.openURL('https://apps.apple.com/account/subscriptions');
    } else if (subscriptionInfo.platform === 'google') {
      // Open Google Play subscription management
      Linking.openURL('https://play.google.com/store/account/subscriptions');
    } else if (subscriptionInfo.platform === 'stripe') {
      // Fetch a fresh portal session URL — portal URLs are single-use and expire
      // This matches how the vendor portal works (fresh URL on each request)
      setManageLoading(true);
      try {
        const freshInfo = await billingService.getSubscriptionInfo();
        if (freshInfo.manage_subscription_url) {
          Linking.openURL(freshInfo.manage_subscription_url);
        } else {
          handleOpenVendorPortal();
        }
      } catch {
        handleOpenVendorPortal();
      } finally {
        setManageLoading(false);
      }
    } else {
      // Fallback: open vendor portal billing page
      handleOpenVendorPortal();
    }
  };

  const getSubscriptionStatusText = () => {
    // Prefer API response (fresh) over AuthContext (may be stale)
    const statusTier = subscriptionInfo?.tier || subscription?.tier;
    const status = subscriptionInfo?.status || subscription?.status;
    const cancel_at = subscriptionInfo?.cancel_at; // Only from billing API

    if (!statusTier || !status) return t('subscriptionStatusFreePlan');

    if (statusTier === 'starter' || status === 'none') {
      return t('subscriptionStatusFreePlan');
    }

    if (status === 'canceled' || cancel_at) {
      const cancelDate = cancel_at ? new Date(cancel_at).toLocaleDateString() : '';
      return cancelDate ? t('subscriptionStatusCancelsOn', { date: cancelDate }) : t('subscriptionStatusCanceled');
    }

    if (status === 'past_due') {
      return t('subscriptionStatusPastDue');
    }

    if (status === 'trialing') {
      return t('subscriptionStatusTrial');
    }

    return t('subscriptionStatusActive');
  };

  const getSubscriptionPlatformIcon = (): string => {
    if (!subscriptionInfo) return 'card-outline';

    switch (subscriptionInfo.platform) {
      case 'apple':
        return 'logo-apple';
      case 'google':
        return 'logo-google';
      case 'manual':
        return 'star-outline';
      default:
        return 'card-outline';
    }
  };

  const getSubscriptionPlatformName = (): string => {
    if (!subscriptionInfo) return '';

    switch (subscriptionInfo.platform) {
      case 'apple':
        return t('platformAppStore');
      case 'google':
        return t('platformGooglePlay');
      case 'stripe':
        return t('platformStripe');
      case 'manual':
        return t('platformRowie');
      default:
        return '';
    }
  };

  const styles = createStyles(colors, isDark);

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.headerContainer}>
          <Text style={styles.title} maxFontSizeMultiplier={1.3}>{t('title')}</Text>
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.content}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
        >
          <View style={styles.contentContainer}>

            {/* Profile Card */}
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.profileCard}
                onPress={() => setShowProfileEdit(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('profileAccessibilityLabel', { firstName: user?.firstName || '', lastName: user?.lastName || '', email: user?.email || '' })}
                accessibilityHint={t('profileAccessibilityHint')}
              >
                {user?.avatarUrl ? (
                  <Image source={{ uri: user.avatarUrl }} style={styles.profileAvatarImage} fadeDuration={0} />
                ) : (
                  <View style={styles.profileAvatar}>
                    <Text style={styles.profileInitials} maxFontSizeMultiplier={1.3}>
                      {user?.firstName?.charAt(0)?.toUpperCase() || ''}{user?.lastName?.charAt(0)?.toUpperCase() || ''}
                    </Text>
                  </View>
                )}
                <View style={styles.profileInfo}>
                  <Text style={styles.profileName} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                    {user?.firstName} {user?.lastName}
                  </Text>
                  <Text style={styles.profileEmail} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                    {user?.email}
                  </Text>
                  {organization?.name && (
                    <Text style={styles.profileOrg} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                      {organization.name}
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>


            {/* Menu Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>{t('sectionMenu')}</Text>
              <View style={styles.card}>
                <View style={styles.row}>
                  <View style={styles.rowLeft}>
                    <Ionicons name="restaurant-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                    <View style={styles.labelContainer}>
                      <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                        {selectedCatalog?.name || t('noneSelected')}
                      </Text>
                      {selectedCatalog?.location && (
                        <Text style={styles.sublabel} numberOfLines={1} maxFontSizeMultiplier={1.5}>{selectedCatalog.location}</Text>
                      )}
                    </View>
                  </View>
                  {catalogs.length > 1 && (
                    <TouchableOpacity
                      style={styles.switchButton}
                      onPress={handleSwitchCatalog}
                      accessibilityRole="button"
                      accessibilityLabel={t('switchMenuAccessibilityLabel')}
                    >
                      <Text style={styles.switchButtonText} maxFontSizeMultiplier={1.3}>{t('switch')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>


            {/* Business Section - Subscription + Banking (owners/admins only) */}
            {(user?.role === 'owner' || user?.role === 'admin') && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>{t('sectionBusiness')}</Text>
                <View style={styles.card}>
                  {/* Vendor Portal */}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={handleOpenVendorPortal}
                    activeOpacity={0.7}
                    accessibilityRole="link"
                    accessibilityLabel={t('vendorPortal')}
                    accessibilityHint={t('vendorPortalAccessibilityHint')}
                  >
                    <View style={styles.rowLeft}>
                      <Ionicons name="storefront-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                      <Text style={styles.label} maxFontSizeMultiplier={1.3}>{t('vendorPortal')}</Text>
                    </View>
                    <Ionicons name="open-outline" size={18} color={colors.textMuted} />
                  </TouchableOpacity>

                  <View style={styles.divider} />

                  {/* Subscription Plan */}
                  {!isPro ? (
                    <TouchableOpacity
                      style={styles.row}
                      accessibilityRole="button"
                      accessibilityLabel={`${subscriptionInfo?.current_plan?.name || t('starterPlan')}, ${t('upgrade').toLowerCase()}`}
                      accessibilityHint={t('upgradeAccessibilityHint')}
                      onPress={() => {
                        if (Platform.OS === 'web' || isStripePlatformUser) {
                          createVendorDashboardUrl('/billing').then(url => {
                            if (url) {
                              Linking.openURL(url);
                            } else {
                              Linking.openURL(`${config.vendorDashboardUrl}/billing`);
                            }
                          });
                        } else {
                          navigation.navigate('Upgrade');
                        }
                      }}
                    >
                      <View style={styles.rowLeft}>
                        <Ionicons name="diamond-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                        <Text style={styles.label} maxFontSizeMultiplier={1.3}>
                          {subscriptionInfo?.current_plan?.name || t('starterPlan')}
                        </Text>
                      </View>
                      <View style={styles.upgradeButton}>
                        <Text style={styles.upgradeButtonText} maxFontSizeMultiplier={1.3}>{t('upgrade')}</Text>
                      </View>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.row}>
                      <View style={styles.rowLeft}>
                        <Ionicons name="diamond" size={20} color={colors.primary} style={styles.rowIcon} />
                        <View style={styles.labelContainer}>
                          <Text style={styles.label} maxFontSizeMultiplier={1.5}>
                            {tier === 'pro' ? t('proPlan') :
                             tier === 'enterprise' ? t('enterprisePlan') :
                             subscriptionInfo?.current_plan?.name || t('starterPlan')}
                          </Text>
                          {subscriptionInfo?.platform === 'manual' ? (
                            <Text style={styles.sublabel} maxFontSizeMultiplier={1.5}>{t('managedByRowie')}</Text>
                          ) : subscriptionInfo?.current_plan?.price ? (
                            <Text style={styles.sublabel} maxFontSizeMultiplier={1.5}>
                              {t('perMonth', { price: formatCents(subscriptionInfo.current_plan.price, subscriptionInfo.current_plan.currency || currency) })}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      {subscriptionLoading ? (
                        <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={t('loadingSubscriptionStatus')} />
                      ) : status === 'past_due' ? (
                        <View style={styles.statusBadgeError}>
                          <Ionicons name="warning" size={14} color={colors.error} />
                          <Text maxFontSizeMultiplier={1.5} style={[styles.statusBadgeText, { color: colors.error }]}>
                            {getSubscriptionStatusText()}
                          </Text>
                        </View>
                      ) : subscriptionInfo?.cancel_at ? (
                        <View style={styles.statusBadgeWarning}>
                          <Ionicons name="time-outline" size={14} color={colors.warning} />
                          <Text maxFontSizeMultiplier={1.5} style={[styles.statusBadgeText, { color: colors.warning }]}>
                            {getSubscriptionStatusText()}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  )}

                  {/* Manage Subscription - for Pro users */}
                  {isPro && subscriptionInfo && subscriptionInfo.status !== 'none' && subscriptionInfo.platform !== 'manual' && (
                    <>
                      <View style={styles.divider} />
                      <TouchableOpacity style={styles.row} onPress={handleManageSubscription} disabled={manageLoading} accessibilityRole="link" accessibilityLabel={t('manageSubscriptionAccessibilityLabel', { platformName: getSubscriptionPlatformName() })}>
                        <View style={styles.rowLeft}>
                          <Ionicons name={getSubscriptionPlatformIcon() as any} size={20} color={colors.textSecondary} style={styles.rowIcon} />
                          <Text style={styles.label} maxFontSizeMultiplier={1.3}>{t('manageSubscription')}</Text>
                        </View>
                        {manageLoading ? (
                          <ActivityIndicator size="small" color={colors.textMuted} accessibilityLabel={t('loadingBillingPortal')} />
                        ) : (
                          <Ionicons name="open-outline" size={18} color={colors.textMuted} />
                        )}
                      </TouchableOpacity>
                    </>
                  )}

                  <View style={styles.divider} />

                  {/* Banking */}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => navigation.navigate('StripeOnboarding', { returnTo: 'settings' })}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('banking')}${connectStatus?.chargesEnabled ? ', ' + t('bankingActiveLabel').toLowerCase() : needsBankingSetup ? ', ' + t('bankingSetupRequired').toLowerCase() : ''}`}
                  >
                    <View style={styles.rowLeft}>
                      <Ionicons name="business-outline" size={20} color={needsBankingSetup ? colors.warning : colors.textSecondary} style={styles.rowIcon} />
                      <View style={styles.labelContainer}>
                        <Text style={styles.label} maxFontSizeMultiplier={1.3}>{t('banking')}</Text>
                        {connectLoading ? (
                          <Text style={styles.sublabel} maxFontSizeMultiplier={1.3}>{t('bankingLoading')}</Text>
                        ) : connectStatus?.chargesEnabled ? (
                          <Text style={styles.sublabel} maxFontSizeMultiplier={1.3}>{t('bankingPayoutsActive')}</Text>
                        ) : (
                          <Text style={[styles.sublabel, { color: colors.warning }]} maxFontSizeMultiplier={1.3}>{t('bankingSetupRequired')}</Text>
                        )}
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {connectLoading ? (
                        <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={t('loadingBankingStatus')} />
                      ) : connectStatus?.chargesEnabled ? (
                        <View style={styles.statusBadgeSuccess}>
                          <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                          <Text style={[styles.statusBadgeText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>{t('bankingActiveLabel')}</Text>
                        </View>
                      ) : (
                        <View style={styles.statusBadgeWarning}>
                          <Ionicons name="alert-circle" size={14} color={colors.warning} />
                          <Text style={[styles.statusBadgeText, { color: colors.warning }]} maxFontSizeMultiplier={1.3}>{t('bankingSetupLabel')}</Text>
                        </View>
                      )}
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Payment Setup - for non-admins when not enabled */}
            {connectStatus && !connectStatus.chargesEnabled && user?.role !== 'owner' && user?.role !== 'admin' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>{t('sectionPayments')}</Text>
                <View style={styles.card}>
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => navigation.navigate('StripeOnboarding', { returnTo: 'settings' })}
                    accessibilityRole="button"
                    accessibilityLabel={t('paymentSetupAccessibilityLabel')}
                  >
                    <View style={styles.rowLeft}>
                      <Ionicons name="card-outline" size={20} color={colors.warning} style={styles.rowIcon} />
                      <View style={styles.labelContainer}>
                        <Text style={styles.label} maxFontSizeMultiplier={1.3}>{t('paymentSetup')}</Text>
                        <Text style={styles.sublabel} maxFontSizeMultiplier={1.3}>{t('paymentSetupRequired')}</Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Device Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>{t('sectionDevice')}</Text>
              <View style={styles.card}>
                {/* Tap to Pay Status */}
                {(() => {
                  const bankingReady = !!connectStatus?.chargesEnabled;
                  const needsSetup = bankingReady && Platform.OS !== 'web' && deviceCompatibility.isCompatible && !isInitialized && !isWarming;
                  const RowComponent = needsSetup ? TouchableOpacity : View;
                  const rowProps = needsSetup ? {
                    onPress: () => navigation.navigate('TapToPayEducation'),
                    accessibilityRole: 'button' as const,
                    accessibilityLabel: `${TAP_TO_PAY_NAME}, ${t('tapToConfigure')}`,
                  } : {
                    accessibilityLabel: `${TAP_TO_PAY_NAME}, ${!bankingReady ? t('completeBankingSetupFirst') : Platform.OS === 'web' ? t('notAvailableOnWeb') : !deviceCompatibility.isCompatible ? t('deviceNotSupported') : isInitialized ? t('ready').toLowerCase() : isWarming ? t('initializing').toLowerCase() : t('tapToConfigure')}`,
                  };

                  return (
                    <RowComponent style={[styles.row, !bankingReady && styles.rowDisabled]} {...rowProps}>
                      <View style={[styles.rowLeft, !bankingReady && { opacity: 0.45 }]}>
                        <Ionicons name="phone-portrait-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                        <View style={styles.labelContainer}>
                          <Text style={styles.label} maxFontSizeMultiplier={1.3}>{TAP_TO_PAY_NAME}</Text>
                          <Text style={styles.sublabel} maxFontSizeMultiplier={1.3}>
                            {!bankingReady
                              ? t('completeBankingSetupFirst')
                              : Platform.OS === 'web'
                                ? t('notAvailableOnWeb')
                                : !deviceCompatibility.isCompatible
                                  ? t('deviceNotSupported')
                                  : isInitialized
                                    ? t('readyToAcceptPayments')
                                    : isWarming
                                      ? t('initializing')
                                      : t('tapToConfigure')}
                          </Text>
                        </View>
                      </View>
                      {!bankingReady ? (
                        <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
                      ) : Platform.OS === 'web' ? (
                        <Text style={styles.rowValueMuted} maxFontSizeMultiplier={1.5}>{t('notAvailable')}</Text>
                      ) : !deviceCompatibility.isCompatible ? (
                        <Ionicons name="close-circle" size={16} color={colors.error} />
                      ) : isInitialized ? (
                        <View style={styles.statusBadgeSuccess}>
                          <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                          <Text style={[styles.statusBadgeText, { color: colors.success }]} maxFontSizeMultiplier={1.5}>{t('ready')}</Text>
                        </View>
                      ) : isWarming ? (
                        <ActivityIndicator size="small" color={colors.warning} accessibilityLabel={t('initializingTapToPay')} />
                      ) : (
                        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                      )}
                    </RowComponent>
                  );
                })()}

                {!connectStatus?.chargesEnabled && (
                  <Text style={styles.rowHint} maxFontSizeMultiplier={1.5}>
                    {t('bankingSetupHint', { tapToPayName: TAP_TO_PAY_NAME })}
                  </Text>
                )}

                <View style={styles.divider} />

                {/* Terminal Readers */}
                {connectStatus?.chargesEnabled ? (
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => navigation.navigate('ReaderManagement')}
                    accessibilityRole="button"
                    accessibilityLabel={t('terminalReaders')}
                    accessibilityHint={t('terminalReadersAccessibilityHint')}
                  >
                    <View style={styles.rowLeft}>
                      <Ionicons name="hardware-chip-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                      <View style={styles.labelContainer}>
                        <Text style={styles.label} maxFontSizeMultiplier={1.3}>{t('terminalReaders')}</Text>
                        <Text style={styles.sublabel} maxFontSizeMultiplier={1.3}>{t('terminalReadersSubtitle')}</Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.row, styles.rowDisabled]}>
                    <View style={[styles.rowLeft, { opacity: 0.45 }]}>
                      <Ionicons name="hardware-chip-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                      <View style={styles.labelContainer}>
                        <Text style={styles.label} maxFontSizeMultiplier={1.3}>{t('terminalReaders')}</Text>
                        <Text style={styles.sublabel} maxFontSizeMultiplier={1.3}>{t('terminalReadersDisabledSubtitle')}</Text>
                      </View>
                    </View>
                    <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
                  </View>
                )}
              </View>
            </View>


            {/* Appearance Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>{t('sectionAppearance')}</Text>
              <View style={styles.card}>
                {/* Dark Mode */}
                <View style={styles.row}>
                  <View style={styles.rowLeft}>
                    <Ionicons name={isDark ? 'moon' : 'sunny'} size={20} color={colors.textSecondary} style={styles.rowIcon} />
                    <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('darkMode')}</Text>
                  </View>
                  <Toggle value={isDark} onValueChange={toggleTheme} accessibilityLabel={t('darkModeAccessibilityLabel')} />
                </View>

                {/* Biometric Login */}
                {biometricCapabilities?.isAvailable && (
                  <>
                    <View style={styles.divider} />
                    <View style={styles.row}>
                      <View style={styles.rowLeft}>
                        <Ionicons
                          name={
                            biometricCapabilities.biometricName === 'Face ID' || biometricCapabilities.biometricName === 'Face Unlock'
                              ? 'scan-outline'
                              : 'finger-print-outline'
                          }
                          size={20}
                          color={colors.textSecondary}
                          style={styles.rowIcon}
                        />
                        <Text style={styles.label} maxFontSizeMultiplier={1.5}>{biometricCapabilities.biometricName}</Text>
                      </View>
                      {biometricLoading ? (
                        <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={t('loadingBiometricSetting')} />
                      ) : (
                        <Toggle
                          value={biometricEnabled}
                          onValueChange={handleBiometricToggle}
                          accessibilityLabel={biometricCapabilities.biometricName}
                        />
                      )}
                    </View>
                  </>
                )}

                {/* Language */}
                <View style={styles.divider} />
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => setShowLanguagePicker(true)}
                  accessibilityLabel={t('languageAccessibilityLabel', { languageName })}
                  accessibilityRole="button"
                >
                  <View style={styles.rowLeft}>
                    <Ionicons name="globe-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                    <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('language')}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.sublabel, { marginTop: 0 }]} maxFontSizeMultiplier={1.3}>{languageName}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </View>
                </TouchableOpacity>
              </View>
            </View>


            {/* About Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>{t('sectionAbout')}</Text>
              <View style={styles.card}>
                {/* Learn Tap to Pay - iOS only */}
                {Platform.OS === 'ios' && (
                  <>
                    <TouchableOpacity
                      style={styles.row}
                      onPress={() => navigation.navigate('TapToPayEducation')}
                      accessibilityRole="button"
                      accessibilityLabel={t('learnTapToPay', { tapToPayName: TAP_TO_PAY_NAME })}
                    >
                      <View style={styles.rowLeft}>
                        <Ionicons name="school-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                        <Text style={styles.label} maxFontSizeMultiplier={1.3}>{t('learnTapToPay', { tapToPayName: TAP_TO_PAY_NAME })}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                    <View style={styles.divider} />
                  </>
                )}

                <TouchableOpacity
                  style={styles.row}
                  onPress={() => Linking.openURL('mailto:support@rowie.io?subject=Rowie Support')}
                  accessibilityRole="link"
                  accessibilityLabel={t('contactSupport')}
                  accessibilityHint={t('contactSupportAccessibilityHint')}
                >
                  <View style={styles.rowLeft}>
                    <Ionicons name="help-circle-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                    <Text style={styles.label} maxFontSizeMultiplier={1.3}>{t('contactSupport')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                <View style={styles.divider} />

                <TouchableOpacity
                  style={styles.row}
                  onPress={() => Linking.openURL(`${config.websiteUrl}/terms`)}
                  accessibilityRole="link"
                  accessibilityLabel={t('termsOfUse')}
                >
                  <View style={styles.rowLeft}>
                    <Ionicons name="document-text-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                    <Text style={styles.label} maxFontSizeMultiplier={1.3}>{t('termsOfUse')}</Text>
                  </View>
                  <Ionicons name="open-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                <View style={styles.divider} />

                <TouchableOpacity
                  style={styles.row}
                  onPress={() => Linking.openURL(`${config.websiteUrl}/privacy`)}
                  accessibilityRole="link"
                  accessibilityLabel={t('privacyPolicy')}
                >
                  <View style={styles.rowLeft}>
                    <Ionicons name="shield-checkmark-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                    <Text style={styles.label} maxFontSizeMultiplier={1.3}>{t('privacyPolicy')}</Text>
                  </View>
                  <Ionicons name="open-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Sign Out */}
            <View style={styles.section}>
              <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} accessibilityRole="button" accessibilityLabel={t('signOut')}>
                <Text style={styles.signOutText} maxFontSizeMultiplier={1.3}>{t('signOut')}</Text>
              </TouchableOpacity>
            </View>

            {/* Delete Account */}
            <View style={styles.sectionSmall}>
              <TouchableOpacity style={styles.deleteAccountButton} onPress={handleDeleteAccount} accessibilityRole="button" accessibilityLabel={t('deleteAccount')}>
                <Text style={styles.deleteAccountText} maxFontSizeMultiplier={1.3}>{t('deleteAccount')}</Text>
              </TouchableOpacity>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
              <Text style={styles.version} maxFontSizeMultiplier={1.5}>{t('version', { version: Constants.expoConfig?.version || '1.0.0' })}</Text>
            </View>
          </View>
        </ScrollView>
      </View>

      {/* Profile Edit Modal */}
      <ProfileEditModal
        visible={showProfileEdit}
        onClose={() => setShowProfileEdit(false)}
      />

      {/* Language Picker Modal */}
      <LanguagePickerModal
        visible={showLanguagePicker}
        onClose={() => setShowLanguagePicker(false)}
      />
    </View>
  );
}

const createStyles = (colors: any, isDark: boolean) => {

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerContainer: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 4,
    },
    title: {
      fontSize: 28,
      fontFamily: fonts.bold,
      color: colors.text,
      letterSpacing: -0.5,
    },
    content: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      alignItems: 'center',
    },
    contentContainer: {
      width: '100%',
      maxWidth: 600,
      paddingBottom: 20,
    },

    // Sections
    section: {
      paddingHorizontal: 20,
      marginTop: 32,
    },
    sectionSmall: {
      paddingHorizontal: 20,
      marginTop: 16,
    },
    sectionTitle: {
      fontSize: 12,
      fontFamily: fonts.semiBold,
      color: colors.textSecondary,
      letterSpacing: 0.5,
      marginBottom: 10,
      marginLeft: 4,
    },

    // Cards
    card: {
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },

    // Rows
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      minHeight: 52,
    },
    rowDisabled: {
      opacity: 0.6,
    },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    rowIcon: {
      marginRight: 14,
      width: 22,
    },
    rowHint: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      paddingHorizontal: 16,
      paddingBottom: 12,
      paddingLeft: 52,
      lineHeight: 18,
    },
    rowValueMuted: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },

    // Divider
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginLeft: 52,
    },

    // Labels
    label: {
      fontSize: 16,
      fontFamily: fonts.medium,
      color: colors.text,
    },
    sublabel: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      marginTop: 2,
    },
    labelContainer: {
      flex: 1,
    },

    // Profile card
    profileCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    profileAvatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    profileAvatarImage: {
      width: 52,
      height: 52,
      borderRadius: 26,
      marginRight: 14,
    },
    profileInitials: {
      fontSize: 19,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    profileInfo: {
      flex: 1,
    },
    profileName: {
      fontSize: 17,
      fontFamily: fonts.semiBold,
      color: colors.text,
      marginBottom: 2,
    },
    profileEmail: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      marginBottom: 2,
    },
    profileOrg: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },

    // Switch button (menu)
    switchButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: colors.chipBg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    switchButtonText: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },

    // Status badges
    statusBadgeSuccess: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: colors.success + '15',
      borderRadius: 8,
    },
    statusBadgeError: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: colors.error + '15',
      borderRadius: 8,
    },
    statusBadgeWarning: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: colors.warning + '15',
      borderRadius: 8,
    },
    statusBadgeText: {
      fontSize: 12,
      fontFamily: fonts.semiBold,
    },

    // Upgrade button
    upgradeButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: colors.primary,
      borderRadius: 10,
    },
    upgradeButtonText: {
      fontSize: 13,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },

    // Sign out
    signOutButton: {
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    signOutText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.error,
    },

    // Delete account
    deleteAccountButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
    },
    deleteAccountText: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },

    // Footer
    footer: {
      alignItems: 'center',
      paddingTop: 24,
      paddingBottom: 16,
    },
    version: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },
  });
};
