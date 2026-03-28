import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { iapService, SubscriptionProduct, SUBSCRIPTION_SKUS } from '../lib/iap';
import { glass } from '../lib/colors';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { config } from '../lib/config';
import logger from '../lib/logger';
import { PRICING } from '../lib/pricing';

const PRO_FEATURES = [
  { icon: 'infinite-outline', text: 'Unlimited custom menus' },
  { icon: 'people-outline', text: 'Unlimited users & devices' },
  { icon: 'person-add-outline', text: 'Staff account management' },
  { icon: 'git-branch-outline', text: 'Revenue splits (venue/promoter)' },
  { icon: 'cash-outline', text: 'Tip reports & tracking' },
  { icon: 'wallet-outline', text: 'Tip pooling & tip-out rules' },
  { icon: 'document-text-outline', text: 'Custom invoicing' },
  { icon: 'analytics-outline', text: 'Analytics dashboard' },
  { icon: 'download-outline', text: 'Export to CSV/PDF' },
];

export function UpgradeScreen() {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const glassColors = isDark ? glass.dark : glass.light;
  const { refreshAuth, user } = useAuth();

  const [product, setProduct] = useState<SubscriptionProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  useEffect(() => {
    loadProduct();
  }, []);

  const loadProduct = async () => {
    setLoading(true);
    try {
      const initialized = await iapService.initialize();
      if (initialized) {
        const products = await iapService.getProducts();
        logger.log('[UpgradeScreen] Products loaded:', products);
        if (products.length > 0) {
          setProduct(products[0]);
        }
      }
    } catch (error) {
      logger.error('[UpgradeScreen] Error loading products:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async () => {
    if (!product) {
      Alert.alert('Error', 'Subscription not available. Please try again later.');
      return;
    }

    setPurchasing(true);
    try {
      await iapService.purchaseSubscription(product.productId, async (result) => {
        setPurchasing(false);
        if (result.success) {
          Alert.alert(
            'Welcome to Pro!',
            'Your subscription is now active. Enjoy all the Pro features!',
            [
              {
                text: 'OK',
                onPress: async () => {
                  // Refresh user profile to get updated subscription
                  await refreshAuth();
                  navigation.goBack();
                },
              },
            ]
          );
        } else if (result.error !== 'Purchase cancelled') {
          Alert.alert('Purchase Failed', result.error || 'Unable to complete purchase.');
        }
      });
    } catch (error: any) {
      setPurchasing(false);
      Alert.alert('Error', error.message || 'Failed to start purchase.');
    }
  };

  const handleRestorePurchases = async () => {
    setRestoring(true);
    try {
      const status = await iapService.restorePurchases();
      if (status.isActive) {
        Alert.alert(
          'Subscription Restored',
          'Your Pro subscription has been restored!',
          [
            {
              text: 'OK',
              onPress: async () => {
                await refreshAuth();
                navigation.goBack();
              },
            },
          ]
        );
      } else {
        Alert.alert('No Subscription Found', 'No active subscription was found to restore.');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to restore purchases.');
    } finally {
      setRestoring(false);
    }
  };

  const styles = createStyles(colors, glassColors);

  const platformName = Platform.OS === 'ios' ? 'App Store' : 'Google Play';
  const price = product?.localizedPrice || PRICING.pro.monthlyPriceDisplay;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>Upgrade to Pro</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.proBadge}>
            <Ionicons name="diamond" size={24} color="#fff" />
          </View>
          <Text style={styles.heroTitle} maxFontSizeMultiplier={1.2}>Rowie Pro</Text>
          <Text style={styles.heroSubtitle} maxFontSizeMultiplier={1.5}>
            Unlock the full potential of your business
          </Text>
        </View>

        {/* Price */}
        <View style={styles.priceContainer}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Loading price" />
          ) : (
            <>
              <Text style={styles.price} maxFontSizeMultiplier={1.2}>{price}</Text>
              <Text style={styles.pricePeriod} maxFontSizeMultiplier={1.3}>/month</Text>
            </>
          )}
        </View>

        {/* Features */}
        <View style={styles.featuresCard}>
          <Text style={styles.featuresTitle} maxFontSizeMultiplier={1.5}>Everything in Pro</Text>
          {PRO_FEATURES.map((feature, index) => (
            <View key={index} style={styles.featureRow}>
              <View style={styles.featureIconContainer}>
                <Ionicons name={feature.icon as any} size={18} color={colors.primary} />
              </View>
              <Text style={styles.featureText} maxFontSizeMultiplier={1.5}>{feature.text}</Text>
            </View>
          ))}
        </View>

        {/* Transaction Fee */}
        <View style={styles.feeCard}>
          <Ionicons name="card-outline" size={20} color={colors.success} />
          <View style={styles.feeTextContainer}>
            <Text style={styles.feeTitle} maxFontSizeMultiplier={1.5}>Lower Transaction Fees</Text>
            <Text style={styles.feeSubtitle} maxFontSizeMultiplier={1.5}>{user?.rates?.tapToPay.pro || PRICING.pro.transactionFeeDisplay} per tap (vs {user?.rates?.tapToPay.starter || PRICING.starter.transactionFeeDisplay})</Text>
          </View>
        </View>

        {/* Subscribe Button */}
        <TouchableOpacity
          onPress={handleSubscribe}
          disabled={loading || purchasing || !product}
          activeOpacity={0.9}
          style={styles.subscribeButtonContainer}
          accessibilityRole="button"
          accessibilityLabel={`Subscribe for ${price} per month`}
          accessibilityState={{ disabled: loading || purchasing || !product }}
        >
          <LinearGradient
            colors={[colors.primary, colors.primary700]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.subscribeButton,
              (loading || purchasing || !product) && styles.subscribeButtonDisabled,
            ]}
          >
            {purchasing ? (
              <ActivityIndicator size="small" color="#fff" accessibilityLabel="Processing purchase" />
            ) : (
              <>
                <Ionicons name="diamond" size={20} color="#fff" />
                <Text style={styles.subscribeButtonText} maxFontSizeMultiplier={1.3}>
                  Subscribe for {price}/month
                </Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Restore Purchases */}
        <TouchableOpacity
          style={styles.restoreButton}
          onPress={handleRestorePurchases}
          disabled={restoring}
          accessibilityRole="button"
          accessibilityLabel="Restore Purchases"
          accessibilityState={{ disabled: restoring }}
        >
          {restoring ? (
            <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Restoring purchases" />
          ) : (
            <Text style={styles.restoreButtonText} maxFontSizeMultiplier={1.3}>Restore Purchases</Text>
          )}
        </TouchableOpacity>

        {/* Legal Text */}
        <Text style={styles.legalText} maxFontSizeMultiplier={1.5}>
          Payment will be charged to your {platformName} account at confirmation of purchase.
          Subscription automatically renews unless auto-renew is turned off at least 24 hours
          before the end of the current period. Your account will be charged for renewal within
          24 hours prior to the end of the current period. You can manage and cancel your
          subscriptions in your {platformName} account settings.
        </Text>

        <View style={styles.legalLinks}>
          <TouchableOpacity
            onPress={() => Linking.openURL(`${config.websiteUrl}/terms`)}
            accessibilityRole="link"
            accessibilityLabel="Terms of Use"
          >
            <Text style={styles.legalLinkText} maxFontSizeMultiplier={1.5}>Terms of Use</Text>
          </TouchableOpacity>
          <Text style={styles.legalLinkSeparator} maxFontSizeMultiplier={1.5}> | </Text>
          <TouchableOpacity
            onPress={() => Linking.openURL(`${config.websiteUrl}/privacy`)}
            accessibilityRole="link"
            accessibilityLabel="Privacy Policy"
          >
            <Text style={styles.legalLinkText} maxFontSizeMultiplier={1.5}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: any, glassColors: typeof glass.dark) => {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 56,
      paddingHorizontal: 16,
      backgroundColor: glassColors.backgroundSubtle,
      borderBottomWidth: 1,
      borderBottomColor: glassColors.borderSubtle,
    },
    backButton: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
    },
    headerTitle: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    content: {
      flex: 1,
    },
    scrollContent: {
      padding: 20,
      paddingBottom: 40,
    },
    hero: {
      alignItems: 'center',
      marginBottom: 24,
    },
    proBadge: {
      width: 64,
      height: 64,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
      ...shadows.lg,
      shadowColor: colors.primary,
    },
    heroTitle: {
      fontSize: 28,
      fontFamily: fonts.bold,
      color: colors.text,
      marginBottom: 8,
    },
    heroSubtitle: {
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    priceContainer: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'center',
      marginBottom: 24,
    },
    price: {
      fontSize: 48,
      fontFamily: fonts.bold,
      color: colors.text,
    },
    pricePeriod: {
      fontSize: 18,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
      marginLeft: 4,
    },
    featuresCard: {
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: glassColors.border,
      padding: 20,
      marginBottom: 16,
      ...shadows.sm,
    },
    featuresTitle: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.text,
      marginBottom: 16,
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
    },
    featureIconContainer: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: colors.primary + '15',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    featureText: {
      flex: 1,
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.text,
    },
    feeCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.success + '15',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.success + '30',
      padding: 16,
      marginBottom: 24,
    },
    feeTextContainer: {
      marginLeft: 12,
    },
    feeTitle: {
      fontSize: 15,
      fontFamily: fonts.semiBold,
      color: colors.success,
    },
    feeSubtitle: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.success,
      opacity: 0.8,
    },
    subscribeButtonContainer: {
      marginBottom: 16,
    },
    subscribeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 18,
      borderRadius: 9999,
      gap: 10,
      ...shadows.lg,
    },
    subscribeButtonDisabled: {
      opacity: 0.6,
    },
    subscribeButtonText: {
      fontSize: 17,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },
    restoreButton: {
      alignItems: 'center',
      paddingVertical: 16,
      marginBottom: 24,
    },
    restoreButtonText: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.primary,
    },
    legalText: {
      fontSize: 11,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 16,
    },
    legalLinks: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 8,
      marginBottom: 16,
    },
    legalLinkText: {
      fontSize: 11,
      fontFamily: fonts.medium,
      color: colors.primary,
    },
    legalLinkSeparator: {
      fontSize: 11,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },
  });
};
