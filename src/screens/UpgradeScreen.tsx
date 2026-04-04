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
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { iapService, SubscriptionProduct, SUBSCRIPTION_SKUS } from '../lib/iap';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { config } from '../lib/config';
import logger from '../lib/logger';
import { PRICING } from '../lib/pricing';
import { useTranslations } from '../lib/i18n';

const PRO_FEATURE_KEYS = [
  { icon: 'infinite-outline', key: 'featureUnlimitedMenus' },
  { icon: 'people-outline', key: 'featureUnlimitedUsers' },
  { icon: 'person-add-outline', key: 'featureStaffManagement' },
  { icon: 'git-branch-outline', key: 'featureRevenueSplits' },
  { icon: 'cash-outline', key: 'featureTipReports' },
  { icon: 'wallet-outline', key: 'featureTipPooling' },
  { icon: 'document-text-outline', key: 'featureInvoicing' },
  { icon: 'analytics-outline', key: 'featureAnalytics' },
  { icon: 'download-outline', key: 'featureExport' },
] as const;

export function UpgradeScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { refreshAuth, user } = useAuth();
  const t = useTranslations('upgrade');
  const tc = useTranslations('common');

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
      Alert.alert(t('errorAlertTitle'), t('subscriptionNotAvailableMessage'));
      return;
    }

    setPurchasing(true);
    try {
      await iapService.purchaseSubscription(product.productId, async (result) => {
        setPurchasing(false);
        if (result.success) {
          Alert.alert(
            t('welcomeToProTitle'),
            t('welcomeToProMessage'),
            [
              {
                text: tc('ok'),
                onPress: async () => {
                  // Refresh user profile to get updated subscription
                  await refreshAuth();
                  navigation.goBack();
                },
              },
            ]
          );
        } else if (result.error !== 'Purchase cancelled') {
          Alert.alert(t('purchaseFailedTitle'), result.error || t('purchaseFailedDefaultMessage'));
        }
      });
    } catch (error: any) {
      setPurchasing(false);
      Alert.alert(t('errorAlertTitle'), error.message || t('errorStartPurchaseDefaultMessage'));
    }
  };

  const handleRestorePurchases = async () => {
    setRestoring(true);
    try {
      const status = await iapService.restorePurchases();
      if (status.isActive) {
        Alert.alert(
          t('subscriptionRestoredTitle'),
          t('subscriptionRestoredMessage'),
          [
            {
              text: tc('ok'),
              onPress: async () => {
                await refreshAuth();
                navigation.goBack();
              },
            },
          ]
        );
      } else {
        Alert.alert(t('noSubscriptionFoundTitle'), t('noSubscriptionFoundMessage'));
      }
    } catch (error: any) {
      Alert.alert(t('errorAlertTitle'), error.message || t('errorRestorePurchasesDefaultMessage'));
    } finally {
      setRestoring(false);
    }
  };

  const styles = createStyles(colors);

  const platformName = Platform.OS === 'ios' ? t('platformNameIos') : t('platformNameAndroid');
  const price = product?.localizedPrice || PRICING.pro.monthlyPriceDisplay;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={t('goBackAccessibilityLabel')}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>{t('headerTitle')}</Text>
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
          <Text style={styles.heroTitle} maxFontSizeMultiplier={1.2}>{t('heroTitle')}</Text>
          <Text style={styles.heroSubtitle} maxFontSizeMultiplier={1.5}>
            {t('heroSubtitle')}
          </Text>
        </View>

        {/* Price */}
        <View style={styles.priceContainer}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={tc('loading')} />
          ) : (
            <>
              <Text style={styles.price} maxFontSizeMultiplier={1.2}>{price}</Text>
              <Text style={styles.pricePeriod} maxFontSizeMultiplier={1.3}>{t('pricePeriod')}</Text>
            </>
          )}
        </View>

        {/* Features */}
        <View style={styles.featuresCard}>
          <Text style={styles.featuresTitle} maxFontSizeMultiplier={1.5}>{t('featuresTitle')}</Text>
          {PRO_FEATURE_KEYS.map((feature, index) => (
            <View key={index} style={styles.featureRow}>
              <View style={styles.featureIconContainer}>
                <Ionicons name={feature.icon as any} size={18} color={colors.primary} />
              </View>
              <Text style={styles.featureText} maxFontSizeMultiplier={1.5}>{t(feature.key)}</Text>
            </View>
          ))}
        </View>

        {/* Transaction Fee */}
        <View style={styles.feeCard}>
          <Ionicons name="card-outline" size={20} color={colors.success} />
          <View style={styles.feeTextContainer}>
            <Text style={styles.feeTitle} maxFontSizeMultiplier={1.5}>{t('lowerTransactionFeesTitle')}</Text>
            <Text style={styles.feeSubtitle} maxFontSizeMultiplier={1.5}>{t('lowerTransactionFeesSubtitle', { proRate: user?.rates?.tapToPay.pro || PRICING.pro.transactionFeeDisplay, starterRate: user?.rates?.tapToPay.starter || PRICING.starter.transactionFeeDisplay })}</Text>
          </View>
        </View>

        {/* Subscribe Button */}
        <TouchableOpacity
          onPress={handleSubscribe}
          disabled={loading || purchasing || !product}
          activeOpacity={0.9}
          style={styles.subscribeButtonContainer}
          accessibilityRole="button"
          accessibilityLabel={t('subscribeAccessibilityLabel', { price })}
          accessibilityState={{ disabled: loading || purchasing || !product }}
        >
          <View
            style={[
              styles.subscribeButton,
              (loading || purchasing || !product) && styles.subscribeButtonDisabled,
            ]}
          >
            {purchasing ? (
              <ActivityIndicator size="small" color="#fff" accessibilityLabel={tc('loading')} />
            ) : (
              <>
                <Ionicons name="diamond" size={20} color="#fff" />
                <Text style={styles.subscribeButtonText} maxFontSizeMultiplier={1.3}>
                  {t('subscribeButtonText', { price })}
                </Text>
              </>
            )}
          </View>
        </TouchableOpacity>

        {/* Restore Purchases */}
        <TouchableOpacity
          style={styles.restoreButton}
          onPress={handleRestorePurchases}
          disabled={restoring}
          accessibilityRole="button"
          accessibilityLabel={t('restorePurchasesButtonText')}
          accessibilityState={{ disabled: restoring }}
        >
          {restoring ? (
            <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={tc('loading')} />
          ) : (
            <Text style={styles.restoreButtonText} maxFontSizeMultiplier={1.3}>{t('restorePurchasesButtonText')}</Text>
          )}
        </TouchableOpacity>

        {/* Legal Text */}
        <Text style={styles.legalText} maxFontSizeMultiplier={1.5}>
          {t('legalText', { platformName })}
        </Text>

        <View style={styles.legalLinks}>
          <TouchableOpacity
            onPress={() => Linking.openURL(`${config.websiteUrl}/terms`)}
            accessibilityRole="link"
            accessibilityLabel={t('termsOfUseText')}
          >
            <Text style={styles.legalLinkText} maxFontSizeMultiplier={1.5}>{t('termsOfUseText')}</Text>
          </TouchableOpacity>
          <Text style={styles.legalLinkSeparator} maxFontSizeMultiplier={1.5}> | </Text>
          <TouchableOpacity
            onPress={() => Linking.openURL(`${config.websiteUrl}/privacy`)}
            accessibilityRole="link"
            accessibilityLabel={t('privacyPolicyText')}
          >
            <Text style={styles.legalLinkText} maxFontSizeMultiplier={1.5}>{t('privacyPolicyText')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: any) => {
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
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
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
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
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
      backgroundColor: colors.primary,
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
