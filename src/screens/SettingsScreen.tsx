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
  Animated,
  Dimensions,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
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
import { glass } from '../lib/colors';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import logger from '../lib/logger';

export function SettingsScreen() {
  const { colors, isDark, toggleTheme } = useTheme();
  const glassColors = isDark ? glass.dark : glass.light;
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
      Alert.alert('Error', `Failed to ${value ? 'enable' : 'disable'} biometric login.`);
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
      'Delete Account',
      'Your account will be deactivated immediately and permanently deleted after 30 days. All your data will be removed and this cannot be undone.\n\nYou can contact support@rowie.io within 30 days to cancel.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await authService.requestAccountDeletion();
              const deletionDate = result.deletionDate
                ? new Date(result.deletionDate).toLocaleDateString()
                : '30 days from now';
              Alert.alert(
                'Account Deletion Scheduled',
                `Your account has been deactivated and is scheduled for permanent deletion on ${deletionDate}. A confirmation email has been sent to ${user?.email || 'your email'}.`,
                [{ text: 'OK', onPress: () => signOut() }]
              );
            } catch (error: any) {
              logger.error('[SettingsScreen] Account deletion request error:', error);
              if (error?.status === 409) {
                Alert.alert('Already Scheduled', 'Your account is already scheduled for deletion.');
              } else {
                Alert.alert('Error', 'Failed to process deletion request. Please try again or contact support@rowie.io.');
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
      Alert.alert('Managed by Rowie', 'Your subscription is managed by Rowie. Contact support for any changes.');
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

    if (!statusTier || !status) return 'Free Plan';

    if (statusTier === 'starter' || status === 'none') {
      return 'Free Plan';
    }

    if (status === 'canceled' || cancel_at) {
      const cancelDate = cancel_at ? new Date(cancel_at).toLocaleDateString() : '';
      return cancelDate ? `Cancels on ${cancelDate}` : 'Canceled';
    }

    if (status === 'past_due') {
      return 'Payment Past Due';
    }

    if (status === 'trialing') {
      return 'Trial';
    }

    return 'Active';
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
        return 'App Store';
      case 'google':
        return 'Google Play';
      case 'stripe':
        return 'Stripe';
      case 'manual':
        return 'Rowie';
      default:
        return '';
    }
  };

  const styles = createStyles(colors, glassColors, isDark);

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.headerContainer}>
          <Text style={styles.title} maxFontSizeMultiplier={1.3}>Settings</Text>
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
        {/* 1. Vendor Portal - Featured section for owners/admins */}
        {(user?.role === 'owner' || user?.role === 'admin') && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.vendorPortalCard}
              onPress={handleOpenVendorPortal}
              activeOpacity={0.8}
              accessibilityRole="link"
              accessibilityLabel="Vendor Portal"
              accessibilityHint="Opens the vendor dashboard to manage products, menus, and reports"
            >
              <LinearGradient
                colors={[colors.primary, colors.primary700 || '#B45309']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.vendorPortalGradient}
              >
                <View style={styles.vendorPortalContent}>
                  <View style={styles.vendorPortalIcon}>
                    <Ionicons name="storefront" size={24} color="#fff" />
                  </View>
                  <View style={styles.vendorPortalText}>
                    <Text style={styles.vendorPortalTitle} maxFontSizeMultiplier={1.3}>Vendor Portal</Text>
                    <Text style={styles.vendorPortalSubtitle} maxFontSizeMultiplier={1.3}>Manage products, menus & reports</Text>
                  </View>
                </View>
                <View style={styles.vendorPortalArrow}>
                  <Ionicons name="arrow-forward" size={20} color="rgba(255,255,255,0.8)" />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* 2. Catalog Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>Menu</Text>
          <View style={styles.card}>
            <View style={styles.activeCatalogRow}>
              <View style={styles.activeCatalogInfo}>
                <View style={styles.activeCatalogBadge}>
                  <View style={styles.activeDot} />
                  <Text style={styles.activeBadgeText} maxFontSizeMultiplier={1.5}>Active</Text>
                </View>
                <Text style={styles.activeCatalogName} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  {selectedCatalog?.name || 'None selected'}
                </Text>
                {selectedCatalog?.location && (
                  <Text style={styles.activeCatalogLocation} numberOfLines={1} maxFontSizeMultiplier={1.5}>{selectedCatalog.location}</Text>
                )}
              </View>
              {catalogs.length > 1 && (
                <TouchableOpacity style={styles.switchButton} onPress={handleSwitchCatalog} accessibilityRole="button" accessibilityLabel="Switch menu">
                  <Ionicons name="swap-horizontal" size={16} color={colors.primary} />
                  <Text style={styles.switchButtonText} maxFontSizeMultiplier={1.3}>Switch</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* 3. Business Section - Subscription + Banking combined (owners/admins only) */}
        {(user?.role === 'owner' || user?.role === 'admin') && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>Business</Text>
          <View style={styles.card}>
            {/* Subscription Plan */}
            {!isPro ? (
              <TouchableOpacity
                style={styles.row}
                accessibilityRole="button"
                accessibilityLabel={`${subscriptionInfo?.current_plan?.name || 'Starter Plan'}, upgrade`}
                accessibilityHint="Navigate to upgrade your subscription plan"
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
                  <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
                    <Ionicons name="diamond-outline" size={18} color={colors.primary} />
                  </View>
                  <Text style={styles.label} maxFontSizeMultiplier={1.3}>
                    {subscriptionInfo?.current_plan?.name || 'Starter Plan'}
                  </Text>
                </View>
                <View style={styles.upgradeButton}>
                  <Ionicons name="rocket" size={14} color="#fff" />
                  <Text style={styles.upgradeButtonText} maxFontSizeMultiplier={1.3}>Upgrade</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={styles.row}>
                <View style={styles.rowLeft}>
                  <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
                    <Ionicons name="diamond" size={18} color={colors.primary} />
                  </View>
                  <View style={styles.labelContainer}>
                    <Text style={styles.label} maxFontSizeMultiplier={1.5}>
                      {tier === 'pro' ? 'Pro Plan' :
                       tier === 'enterprise' ? 'Enterprise Plan' :
                       subscriptionInfo?.current_plan?.name || 'Starter Plan'}
                    </Text>
                    {subscriptionInfo?.platform === 'manual' ? (
                      <Text style={styles.sublabel} maxFontSizeMultiplier={1.5}>Managed by Rowie</Text>
                    ) : subscriptionInfo?.current_plan?.price ? (
                      <Text style={styles.sublabel} maxFontSizeMultiplier={1.5}>
                        {formatCents(subscriptionInfo.current_plan.price, subscriptionInfo.current_plan.currency || currency)}/month
                      </Text>
                    ) : null}
                  </View>
                </View>
                {subscriptionLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Loading subscription status" />
                ) : (
                  <View style={[
                    styles.statusBadgeSuccess,
                    status === 'past_due' && styles.statusBadgeError,
                    subscriptionInfo?.cancel_at && styles.statusBadgeWarning,
                  ]}>
                    <Ionicons
                      name={
                        status === 'past_due' ? 'warning' :
                        subscriptionInfo?.cancel_at ? 'time-outline' : 'checkmark-circle'
                      }
                      size={14}
                      color={
                        status === 'past_due' ? colors.error :
                        subscriptionInfo?.cancel_at ? colors.warning : colors.success
                      }
                    />
                    <Text maxFontSizeMultiplier={1.5} style={[
                      styles.statusBadgeText,
                      {
                        color: status === 'past_due' ? colors.error :
                          subscriptionInfo?.cancel_at ? colors.warning : colors.success
                      }
                    ]}>
                      {getSubscriptionStatusText()}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Manage Subscription - for Pro users */}
            {isPro && subscriptionInfo && subscriptionInfo.status !== 'none' && subscriptionInfo.platform !== 'manual' && (
              <>
                <View style={styles.divider} />
                <TouchableOpacity style={styles.row} onPress={handleManageSubscription} disabled={manageLoading} accessibilityRole="link" accessibilityLabel={`Manage subscription via ${getSubscriptionPlatformName()}`}>
                  <View style={styles.rowLeft}>
                    <View style={[styles.iconContainer, { backgroundColor: colors.textSecondary + '15' }]}>
                      <Ionicons name={getSubscriptionPlatformIcon() as any} size={18} color={colors.textSecondary} />
                    </View>
                    <Text style={styles.label} maxFontSizeMultiplier={1.3}>Manage Subscription</Text>
                  </View>
                  {manageLoading ? (
                    <ActivityIndicator size="small" color={colors.textMuted} accessibilityLabel="Loading billing portal" />
                  ) : (
                    <Ionicons name="open-outline" size={18} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
              </>
            )}

            {/* Banking - for owners/admins */}
            {(user?.role === 'owner' || user?.role === 'admin') && (
              <>
                <View style={styles.divider} />
                <TouchableOpacity
                  style={[styles.row, needsBankingSetup && styles.rowHighlighted]}
                  onPress={() => navigation.navigate('StripeOnboarding', { returnTo: 'settings' })}
                  accessibilityRole="button"
                  accessibilityLabel={`Banking${connectStatus?.chargesEnabled ? ', active' : needsBankingSetup ? ', setup required' : ''}`}
                >
                  <View style={styles.rowLeft}>
                    <View style={[styles.iconContainer, { backgroundColor: needsBankingSetup ? colors.warning + '15' : colors.primary + '15' }]}>
                      <Ionicons name="business-outline" size={18} color={needsBankingSetup ? colors.warning : colors.primary} />
                    </View>
                    <View style={styles.labelContainer}>
                      <Text style={styles.label} maxFontSizeMultiplier={1.3}>Banking</Text>
                      {connectLoading ? (
                        <Text style={styles.sublabel} maxFontSizeMultiplier={1.3}>Loading...</Text>
                      ) : connectStatus?.chargesEnabled ? (
                        <Text style={styles.sublabel} maxFontSizeMultiplier={1.3}>Payments & payouts active</Text>
                      ) : (
                        <Text style={[styles.sublabel, { color: colors.warning }]} maxFontSizeMultiplier={1.3}>Setup required</Text>
                      )}
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {connectLoading ? (
                      <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Loading banking status" />
                    ) : connectStatus?.chargesEnabled ? (
                      <View style={styles.statusBadgeSuccess}>
                        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                        <Text style={[styles.statusBadgeText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>Active</Text>
                      </View>
                    ) : (
                      <View style={styles.statusBadgeWarning}>
                        <Ionicons name="alert-circle" size={14} color={colors.warning} />
                        <Text style={[styles.statusBadgeText, { color: colors.warning }]} maxFontSizeMultiplier={1.3}>Setup</Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </View>
                </TouchableOpacity>
              </>
            )}

            {/* Payment Setup - for non-admins when not enabled */}
            {connectStatus && !connectStatus.chargesEnabled && user?.role !== 'owner' && user?.role !== 'admin' && (
              <>
                <View style={styles.divider} />
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => navigation.navigate('StripeOnboarding', { returnTo: 'settings' })}
                  accessibilityRole="button"
                  accessibilityLabel="Payment setup, required to accept payments"
                >
                  <View style={styles.rowLeft}>
                    <View style={[styles.iconContainer, { backgroundColor: colors.warning + '15' }]}>
                      <Ionicons name="card-outline" size={18} color={colors.warning} />
                    </View>
                    <View style={styles.labelContainer}>
                      <Text style={styles.label} maxFontSizeMultiplier={1.3}>Payment Setup</Text>
                      <Text style={styles.sublabel} maxFontSizeMultiplier={1.3}>Required to accept payments</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
        )}

        {/* 4. Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>Account</Text>
          <View style={styles.card}>
            {/* Profile Card */}
            <TouchableOpacity
              style={styles.profileCard}
              onPress={() => setShowProfileEdit(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Profile, ${user?.firstName} ${user?.lastName}, ${user?.email}`}
              accessibilityHint="Tap to edit your profile"
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
                <View style={styles.profileOrgRow}>
                  <Ionicons name="business-outline" size={12} color={colors.textMuted} />
                  <Text style={styles.profileOrg} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                    {organization?.name}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>

            {/* Biometric Login */}
            {biometricCapabilities?.isAvailable && (
              <>
                <View style={styles.dividerFull} />
                <View style={styles.row}>
                  <View style={styles.rowLeft}>
                    <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
                      <Ionicons
                        name={
                          biometricCapabilities.biometricName === 'Face ID' || biometricCapabilities.biometricName === 'Face Unlock'
                            ? 'scan-outline'
                            : 'finger-print-outline'
                        }
                        size={18}
                        color={colors.primary}
                      />
                    </View>
                    <Text style={styles.label} maxFontSizeMultiplier={1.5}>{biometricCapabilities.biometricName}</Text>
                  </View>
                  {biometricLoading ? (
                    <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Loading biometric setting" />
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
          </View>
        </View>

        {/* 5. Device Section - Simplified Tap to Pay */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>Device</Text>
          <View style={styles.card}>
            {/* Tap to Pay Status - Only tappable when needs configuration and banking is set up */}
            {(() => {
              const bankingReady = !!connectStatus?.chargesEnabled;
              const needsSetup = bankingReady && Platform.OS !== 'web' && deviceCompatibility.isCompatible && !isInitialized && !isWarming;
              const RowComponent = needsSetup ? TouchableOpacity : View;
              const rowProps = needsSetup ? {
                onPress: () => navigation.navigate('TapToPayEducation'),
                accessibilityRole: 'button' as const,
                accessibilityLabel: `${TAP_TO_PAY_NAME}, tap to configure`,
              } : {
                accessibilityLabel: `${TAP_TO_PAY_NAME}, ${!bankingReady ? 'complete banking setup first' : Platform.OS === 'web' ? 'not available on web' : !deviceCompatibility.isCompatible ? 'device not supported' : isInitialized ? 'ready' : isWarming ? 'initializing' : 'needs configuration'}`,
              };

              return (
                <RowComponent style={[styles.row, !bankingReady && styles.rowDisabled]} {...rowProps}>
                  <View style={[styles.rowLeft, !bankingReady && { opacity: 0.45 }]}>
                    <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
                      <Ionicons name="phone-portrait-outline" size={18} color={colors.primary} />
                    </View>
                    <View style={styles.labelContainer}>
                      <Text style={styles.label} maxFontSizeMultiplier={1.3}>{TAP_TO_PAY_NAME}</Text>
                      <Text style={styles.sublabel} maxFontSizeMultiplier={1.3}>
                        {!bankingReady
                          ? 'Complete banking setup first'
                          : Platform.OS === 'web'
                            ? 'Not available on web'
                            : !deviceCompatibility.isCompatible
                              ? 'Device not supported'
                              : isInitialized
                                ? 'Ready to accept payments'
                                : isWarming
                                  ? 'Initializing...'
                                  : 'Tap to configure'}
                      </Text>
                    </View>
                  </View>
                  {!bankingReady ? (
                    <View style={styles.statusBadgeMuted}>
                      <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
                    </View>
                  ) : Platform.OS === 'web' ? (
                    <View style={styles.statusBadgeMuted}>
                      <Ionicons name="desktop-outline" size={14} color={colors.textMuted} />
                      <Text style={[styles.statusBadgeText, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>N/A</Text>
                    </View>
                  ) : !deviceCompatibility.isCompatible ? (
                    <View style={styles.statusBadgeError}>
                      <Ionicons name="close-circle" size={14} color={colors.error} />
                    </View>
                  ) : isInitialized ? (
                    <View style={styles.statusBadgeSuccess}>
                      <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                      <Text style={[styles.statusBadgeText, { color: colors.success }]} maxFontSizeMultiplier={1.5}>Ready</Text>
                    </View>
                  ) : isWarming ? (
                    <View style={styles.statusBadgeWarning}>
                      <ActivityIndicator size="small" color={colors.warning} accessibilityLabel="Initializing Tap to Pay" />
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  )}
                </RowComponent>
              );
            })()}

            {!connectStatus?.chargesEnabled && (
              <Text style={styles.rowHint} maxFontSizeMultiplier={1.5}>
                You must complete banking setup before you can enable {TAP_TO_PAY_NAME}. Go to Banking above to get started.
              </Text>
            )}

            <View style={styles.divider} />

            {/* Terminal Readers */}
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate('ReaderManagement')}
              accessibilityRole="button"
              accessibilityLabel="Terminal Readers"
              accessibilityHint="Manage physical card readers and Bluetooth devices"
            >
              <View style={styles.rowLeft}>
                <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name="hardware-chip-outline" size={18} color={colors.primary} />
                </View>
                <View style={styles.labelContainer}>
                  <Text style={styles.label} maxFontSizeMultiplier={1.3}>Terminal Readers</Text>
                  <Text style={styles.sublabel} maxFontSizeMultiplier={1.3}>Physical card readers & Bluetooth</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Dark Mode */}
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name={isDark ? 'moon' : 'sunny'} size={18} color={colors.primary} />
                </View>
                <Text style={styles.label} maxFontSizeMultiplier={1.5}>Dark Mode</Text>
              </View>
              <Toggle value={isDark} onValueChange={toggleTheme} accessibilityLabel="Dark mode" />
            </View>
          </View>
        </View>

        {/* 6. Support Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>Support</Text>
          <View style={styles.card}>
            {/* Learn Tap to Pay - iOS only (Android auto-enables without education) */}
            {Platform.OS === 'ios' && (
              <>
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => navigation.navigate('TapToPayEducation')}
                  accessibilityRole="button"
                  accessibilityLabel={`Learn ${TAP_TO_PAY_NAME}`}
                >
                  <View style={styles.rowLeft}>
                    <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
                      <Ionicons name="school-outline" size={18} color={colors.primary} />
                    </View>
                    <Text style={styles.label} maxFontSizeMultiplier={1.3}>Learn {TAP_TO_PAY_NAME}</Text>
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
              accessibilityLabel="Contact support"
              accessibilityHint="Opens email to support@rowie.io"
            >
              <View style={styles.rowLeft}>
                <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name="help-circle-outline" size={18} color={colors.primary} />
                </View>
                <Text style={styles.label} maxFontSizeMultiplier={1.3}>Contact Support</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.row}
              onPress={() => Linking.openURL(`${config.websiteUrl}/terms`)}
              accessibilityRole="link"
              accessibilityLabel="Terms of Use"
            >
              <View style={styles.rowLeft}>
                <View style={[styles.iconContainer, { backgroundColor: colors.textSecondary + '15' }]}>
                  <Ionicons name="document-text-outline" size={18} color={colors.textSecondary} />
                </View>
                <Text style={styles.label} maxFontSizeMultiplier={1.3}>Terms of Use</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.row}
              onPress={() => Linking.openURL(`${config.websiteUrl}/privacy`)}
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy"
            >
              <View style={styles.rowLeft}>
                <View style={[styles.iconContainer, { backgroundColor: colors.textSecondary + '15' }]}>
                  <Ionicons name="shield-checkmark-outline" size={18} color={colors.textSecondary} />
                </View>
                <Text style={styles.label} maxFontSizeMultiplier={1.3}>Privacy Policy</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sign Out */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} accessibilityRole="button" accessibilityLabel="Sign out">
            <Ionicons name="log-out-outline" size={20} color={colors.error} />
            <Text style={styles.signOutText} maxFontSizeMultiplier={1.3}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* Delete Account */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.deleteAccountButton} onPress={handleDeleteAccount} accessibilityRole="button" accessibilityLabel="Delete account">
            <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
            <Text style={styles.deleteAccountText} maxFontSizeMultiplier={1.3}>Delete Account</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.version} maxFontSizeMultiplier={1.5}>Rowie v{Constants.expoConfig?.version || '1.0.0'}</Text>
        </View>
        </View>
      </ScrollView>
      </View>

      {/* Profile Edit Modal */}
      <ProfileEditModal
        visible={showProfileEdit}
        onClose={() => setShowProfileEdit(false)}
      />
    </View>
  );
}

const createStyles = (colors: any, glassColors: typeof glass.dark, isDark: boolean) => {
  const cardBackground = isDark ? '#292524' : 'rgba(255,255,255,0.95)';
  const cardBorder = isDark ? '#292524' : 'rgba(0,0,0,0.08)';

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerContainer: {
      paddingTop: 4,
    },
    title: {
      fontSize: 22,
      fontFamily: fonts.bold,
      color: colors.text,
      letterSpacing: -0.3,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    content: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    scrollContent: {
      flexGrow: 1,
      alignItems: 'center',
      backgroundColor: 'transparent',
    },
    contentContainer: {
      width: '100%',
      maxWidth: 600,
    },
    section: {
      paddingHorizontal: 16,
      marginTop: 24,
    },
    sectionTitle: {
      fontSize: 13,
      fontFamily: fonts.semiBold,
      color: colors.textSecondary,
      marginBottom: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginLeft: 4,
    },
    card: {
      backgroundColor: cardBackground,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: cardBorder,
      overflow: 'hidden',
      ...shadows.sm,
    },
    activeCatalogRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
    },
    activeCatalogInfo: {
      flex: 1,
      marginRight: 12,
    },
    activeCatalogBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
    },
    activeDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.success,
    },
    activeBadgeText: {
      fontSize: 11,
      fontFamily: fonts.semiBold,
      color: colors.success,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    activeCatalogName: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    activeCatalogLocation: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      marginTop: 2,
    },
    switchButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: colors.primary + '15',
      borderRadius: 12,
    },
    switchButtonText: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      minHeight: 56,
    },
    rowHighlighted: {
      backgroundColor: colors.warning + '10',
      borderLeftWidth: 3,
      borderLeftColor: colors.warning,
    },
    rowDisabled: {
      borderLeftWidth: 3,
      borderLeftColor: colors.textMuted + '40',
    },
    rowHint: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      paddingHorizontal: 16,
      paddingBottom: 12,
      lineHeight: 18,
    },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    rowLeftCompact: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    rowRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    iconContainer: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    divider: {
      height: 1,
      backgroundColor: cardBorder,
      marginLeft: 64,
    },
    dividerFull: {
      height: 1,
      backgroundColor: cardBorder,
    },
    profileCard: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
    },
    profileAvatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary + '20',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    profileAvatarImage: {
      width: 56,
      height: 56,
      borderRadius: 28,
      marginRight: 14,
    },
    profileInitials: {
      fontSize: 20,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    profileInfo: {
      flex: 1,
    },
    profileName: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
      marginBottom: 2,
    },
    profileEmail: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      marginBottom: 4,
    },
    profileOrgRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    profileOrg: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },
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
    value: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      flexShrink: 1,
      textAlign: 'right',
    },
    valueWide: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      flex: 1,
      textAlign: 'right',
      marginLeft: 12,
    },
    // Status badge styles for Tap to Pay section
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
    statusBadgeMuted: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: colors.textMuted + '15',
      borderRadius: 8,
    },
    statusBadgeText: {
      fontSize: 12,
      fontFamily: fonts.semiBold,
    },
    upgradeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
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
    vendorPortalCard: {
      borderRadius: 16,
      overflow: 'hidden',
      ...shadows.md,
    },
    vendorPortalGradient: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 18,
      paddingHorizontal: 18,
    },
    vendorPortalContent: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    vendorPortalIcon: {
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: 'rgba(255,255,255,0.2)',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    vendorPortalText: {
      flex: 1,
    },
    vendorPortalTitle: {
      fontSize: 17,
      fontFamily: fonts.semiBold,
      color: '#fff',
      marginBottom: 2,
    },
    vendorPortalSubtitle: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: 'rgba(255,255,255,0.8)',
    },
    vendorPortalArrow: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.15)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 16,
      backgroundColor: colors.error + '10',
      borderTopWidth: 1,
      borderTopColor: colors.error + '20',
    },
    errorBoxText: {
      flex: 1,
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.error,
      lineHeight: 18,
    },
    warningBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 16,
      backgroundColor: colors.warning + '10',
      borderTopWidth: 1,
      borderTopColor: colors.warning + '20',
    },
    warningBoxText: {
      flex: 1,
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.warning,
      lineHeight: 18,
    },
    infoBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 16,
      backgroundColor: colors.primary + '10',
      borderTopWidth: 1,
      borderTopColor: colors.primary + '20',
    },
    infoBoxText: {
      flex: 1,
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.primary,
      lineHeight: 18,
    },
    // Configuration progress styles - Apple TTPOi 3.9.1
    progressSection: {
      paddingHorizontal: 16,
      paddingBottom: 16,
      paddingTop: 8,
    },
    progressBarBackground: {
      height: 6,
      backgroundColor: isDark ? '#44403C' : '#E7E5E4',
      borderRadius: 3,
      overflow: 'hidden',
      marginBottom: 8,
    },
    progressBarFill: {
      height: '100%',
      borderRadius: 3,
    },
    progressStageText: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      textAlign: 'center',
    },
    signOutButton: {
      flexDirection: 'row',
      backgroundColor: isDark ? '#2a1212' : colors.errorBg,
      borderRadius: 20,
      paddingVertical: 18,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      borderWidth: 1,
      borderColor: isDark ? '#3d1f1f' : 'transparent',
    },
    signOutText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.error,
    },
    deleteAccountButton: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingVertical: 14,
      gap: 8,
    },
    deleteAccountText: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },
    footer: {
      alignItems: 'center',
      paddingVertical: 32,
      paddingBottom: 48,
    },
    version: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },
  });
};
