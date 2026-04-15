import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import PhoneInput, { ICountry, isValidPhoneNumber } from 'react-native-international-phone-number';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { Input } from '../components/Input';
import { authService } from '../lib/api';
import { iapService, SUBSCRIPTION_SKUS, SubscriptionProduct } from '../lib/iap';
import { storeCredentials } from '../lib/biometricAuth';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { config } from '../lib/config';
import logger from '../lib/logger';
import { isValidEmail } from '../lib/validation';
import { PRICING } from '../lib/pricing';
import { COUNTRIES, COUNTRY_CODES, getTTPDisplayRate } from '../lib/countries';
import { useTranslations } from '../lib/i18n';

// Types
type Step = 'account' | 'business' | 'plan' | 'confirmation';
type PlanType = 'starter' | 'pro';

interface FormData {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  businessName: string;
  businessType: string;
  country: string;
  phone: string;
  selectedPlan: PlanType;
  acceptTerms: boolean;
}

interface FormErrors {
  [key: string]: string;
}

// Business type options — keys map to auth.businessType* translation keys
const BUSINESS_TYPE_KEYS = [
  'businessTypeEventVendor',
  'businessTypeFestivalOrganizer',
  'businessTypeFoodTruck',
  'businessTypeMobileBar',
  'businessTypePopUpShop',
  'businessTypeRestaurant',
  'businessTypeOther',
] as const;

function getDeviceCountry(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
    const parts = locale.split('-');
    const region = parts[parts.length - 1]?.toUpperCase();
    if (region && region.length === 2 && COUNTRY_CODES.has(region)) {
      return region;
    }
  } catch {}
  return 'US';
}

// Build i18n-keyed country list from centralized config (lib/countries.ts)
// i18nKey convention: "country" + name with spaces removed, e.g. "countryNewZealand"
const SUPPORTED_COUNTRIES = COUNTRIES.map(c => ({
  code: c.code,
  i18nKey: `country${c.name.replace(/\s+/g, '')}` as const,
}));

// Static constants — hoisted out of component to avoid re-creation on every render
const STEPS: Step[] = ['account', 'business', 'plan', 'confirmation'];
const STEP_CONFIG = [
  { key: 'account', icon: 'mail-outline', i18nKey: 'signUpStepAccountLabel' },
  { key: 'business', icon: 'briefcase-outline', i18nKey: 'signUpStepBusinessLabel' },
  { key: 'plan', icon: 'rocket-outline', i18nKey: 'signUpStepPlanLabel' },
] as const;

// Plan feature i18n keys — resolved with t() at render time
const STARTER_FEATURE_KEYS = [
  'starterFeatureTapToPay',
  'starterFeatureMenuBuilder',
  'starterFeatureOneMenu',
  'starterFeatureEvents',
  'starterFeaturePayoutSummary',
  'starterFeatureOneUser',
] as const;

const STARTER_NOT_INCLUDED_KEYS = [
  'starterNotIncludedOnlineOrdering',
  'starterNotIncludedTeamPay',
  'starterNotIncludedAnalytics',
  'starterNotIncludedAdditionalStaff',
] as const;

const PRO_FEATURE_KEYS = [
  'proFeatureEverythingInStarter',
  'proFeatureUnlimitedMenus',
  'proFeatureUnlimitedUsers',
  'proFeatureStaffManagement',
  'proFeatureTeamPay',
  'proFeatureInvoicing',
  'proFeatureAnalytics',
  'proFeatureExport',
] as const;

export function SignUpScreen() {
  const { colors, isDark } = useTheme();
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { signIn } = useAuth();
  const scrollViewRef = useRef<ScrollView>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Form state
  const [currentStep, setCurrentStep] = useState<Step>('account');
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    businessName: '',
    businessType: '',
    country: getDeviceCountry(),
    phone: '',
    selectedPlan: 'starter',
    acceptTerms: false,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [isCheckingPassword, setIsCheckingPassword] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [iapProduct, setIapProduct] = useState<SubscriptionProduct | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showBusinessTypePicker, setShowBusinessTypePicker] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<ICountry | null>(null);

  // Combined loading state for disabling form fields
  const isFormDisabled = isLoading || isCheckingEmail || isCheckingPassword || isPurchasing;

  // Phone input callbacks — store raw digits for submission but don't feed back into value
  const [phoneInputValue, setPhoneInputValue] = useState('');
  const phoneOnChange = useCallback((phoneNumber: string) => {
    setPhoneInputValue(phoneNumber);
    const digits = phoneNumber.replace(/\D/g, '');
    setFormData(prev => ({ ...prev, phone: digits }));
  }, []);
  const phoneOnChangeCountry = useCallback((country: ICountry) => {
    setSelectedCountry(country);
  }, []);

  const currentStepIndex = STEPS.indexOf(currentStep);

  // Memoize progress bar interpolation so it's not recreated on every render
  const progressWidth = useMemo(() => progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  }), [progressAnim]);

  // Animate progress bar
  useEffect(() => {
    const progress = ((currentStepIndex + 1) / STEPS.length) * 100;
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [currentStepIndex, progressAnim]);

  // Scroll to top when step changes
  useEffect(() => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }, [currentStep]);

  // Initialize IAP and fetch products — deferred until plan step to avoid blocking
  // the JS-native bridge during account/business steps (StoreKit/Play Billing init is heavy).
  // Note: No cleanup on unmount — iapService is a singleton and cleanup() from a stale
  // unmount races with initialize() from the next mount, tearing down the connection
  // mid-fetch. The IAP connection is lightweight and persists safely.
  useEffect(() => {
    if (currentStep !== 'plan') return;
    if (iapProduct) return; // Already loaded

    let mounted = true;

    const initIAP = async () => {
      try {
        await iapService.initialize();
        const products = await iapService.getProducts();
        if (mounted && products.length > 0) {
          setIapProduct(products[0]);
          logger.log('[SignUp] IAP product loaded:', products[0].productId);
        }
      } catch (error) {
        logger.error('[SignUp] Failed to initialize IAP:', error);
      }
    };
    initIAP();

    return () => {
      mounted = false;
    };
  }, [currentStep, iapProduct]);

  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  // Update form field — stable callback to prevent Input re-renders
  const updateField = useCallback((field: keyof FormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => {
      if (!prev[field]) return prev;
      const newErrors = { ...prev };
      delete newErrors[field];
      return newErrors;
    });
  }, []);

  // Stable per-field callbacks so memo'd Input components don't re-render
  const onChangeEmail = useCallback((v: string) => updateField('email', v), [updateField]);
  const onChangePassword = useCallback((v: string) => updateField('password', v), [updateField]);
  const onChangeConfirmPassword = useCallback((v: string) => updateField('confirmPassword', v), [updateField]);
  const onChangeFirstName = useCallback((v: string) => updateField('firstName', v), [updateField]);
  const onChangeLastName = useCallback((v: string) => updateField('lastName', v), [updateField]);
  const onChangeBusinessName = useCallback((v: string) => updateField('businessName', v), [updateField]);
  const toggleShowPassword = useCallback(() => setShowPassword(prev => !prev), []);

  // Memoized rightIcon for password field so Input memo isn't defeated
  const passwordRightIcon = useMemo(() => (
    <TouchableOpacity
      onPress={toggleShowPassword}
      style={styles.eyeButton}
      accessibilityRole="button"
      accessibilityLabel={showPassword ? t('hidePassword') : t('showPassword')}
    >
      <Ionicons
        name={showPassword ? 'eye-off-outline' : 'eye-outline'}
        size={20}
        color={colors.textSecondary}
      />
    </TouchableOpacity>
  ), [showPassword, toggleShowPassword, styles.eyeButton]);

  // Check email availability
  const checkEmailAvailability = async (email: string): Promise<boolean> => {
    try {
      setIsCheckingEmail(true);
      const response = await fetch(`${config.apiUrl}/auth/check-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      return !data.inUse;
    } catch (error) {
      logger.error('Error checking email:', error);
      return true; // Allow to proceed if check fails
    } finally {
      setIsCheckingEmail(false);
    }
  };

  // Validate current step
  const validateStep = async (): Promise<boolean> => {
    const newErrors: FormErrors = {};

    if (currentStep === 'account') {
      if (!formData.email) {
        newErrors.email = t('emailRequired');
      } else if (!isValidEmail(formData.email)) {
        newErrors.email = t('emailInvalid');
      } else {
        const isAvailable = await checkEmailAvailability(formData.email);
        if (!isAvailable) {
          newErrors.email = t('emailAlreadyInUse');
        }
      }

      if (!formData.password) {
        newErrors.password = t('passwordRequired');
      } else {
        // Check password against server-side policy
        try {
          setIsCheckingPassword(true);
          const passwordResult = await authService.checkPassword(formData.password);
          if (!passwordResult.valid) {
            newErrors.password = passwordResult.errors.join('. ');
          }
        } catch (error) {
          logger.error('[SignUp] Password check error:', error);
          // Fall back to basic validation if API fails
          if (formData.password.length < 8) {
            newErrors.password = t('passwordTooShort');
          }
        } finally {
          setIsCheckingPassword(false);
        }
      }

      if (!formData.confirmPassword) {
        newErrors.confirmPassword = t('confirmPasswordRequired');
      } else if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = t('passwordsDoNotMatch');
      }
    }

    if (currentStep === 'business') {
      if (!formData.firstName.trim()) {
        newErrors.firstName = t('firstNameRequired');
      }
      if (!formData.lastName.trim()) {
        newErrors.lastName = t('lastNameRequired');
      }
      if (!formData.businessName.trim()) {
        newErrors.businessName = t('businessNameRequired');
      } else if (formData.businessName.trim().length < 2) {
        newErrors.businessName = t('businessNameTooShort');
      }
      if (!formData.businessType) {
        newErrors.businessType = t('businessTypeRequired');
      }
      if (!formData.acceptTerms) {
        newErrors.acceptTerms = t('acceptTermsRequired');
      }
      if (formData.phone && selectedCountry && !isValidPhoneNumber(formData.phone, selectedCountry)) {
        newErrors.phone = t('phoneInvalid');
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle next step
  const handleNext = async () => {
    Keyboard.dismiss();

    const isValid = await validateStep();
    if (!isValid) return;

    if (currentStep === 'account') {
      setCurrentStep('business');
    } else if (currentStep === 'business') {
      // Create the account BEFORE showing plan selection
      // This ensures we don't have orphaned payments if account creation fails
      setIsLoading(true);
      try {
        logger.log('[SignUp] Creating account before plan selection...');
        await createAccount('starter');
        logger.log('[SignUp] Account created successfully, proceeding to plan selection');
        setCurrentStep('plan');
      } catch (error: any) {
        logger.error('[SignUp] Account creation failed:', error);
        Alert.alert(t('errorAlertTitle'), error.message || t('failedToCreateAccount'));
      } finally {
        setIsLoading(false);
      }
    } else if (currentStep === 'plan') {
      await handleSignUp();
    }
  };

  // Handle back
  const handleBack = () => {
    if (currentStep === 'business') {
      setCurrentStep('account');
    } else if (currentStep === 'plan') {
      setCurrentStep('business');
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Login' as never);
    }
  };

  // Create account via API
  const createAccount = async (
    tier: 'starter' | 'pro',
    iapData?: { receipt: string; transactionId?: string; productId?: string }
  ): Promise<boolean> => {
    logger.log('[SignUp] ========== CREATE ACCOUNT ==========');
    logger.log('[SignUp] Tier:', tier);
    logger.log('[SignUp] Has IAP data:', !!iapData);

    if (iapData) {
      logger.log('[SignUp] IAP Platform:', Platform.OS);
      logger.log('[SignUp] IAP Product ID:', iapData.productId);
      logger.log('[SignUp] IAP Transaction ID:', iapData.transactionId);
      logger.log('[SignUp] IAP Receipt length:', iapData.receipt?.length || 0);
      logger.log('[SignUp] IAP Receipt preview:', iapData.receipt?.substring(0, 50) + '...');
    }

    const signupData = {
      email: formData.email.trim().toLowerCase(),
      password: formData.password,
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim(),
      organizationName: formData.businessName.trim(),
      phone: formData.phone.replace(/\D/g, ''),
      country: formData.country,
      acceptTerms: formData.acceptTerms,
      acceptPrivacy: formData.acceptTerms,
      subscriptionTier: tier,
      // Always send signup platform so subscription is tied to correct platform
      // Mobile signups -> 'apple'/'google', prevents them from being marked as 'stripe'
      signupPlatform: Platform.OS as 'ios' | 'android',
      // IAP data for mobile app purchases (Pro tier with completed purchase)
      ...(iapData && {
        iapPlatform: Platform.OS as 'ios' | 'android',
        iapReceipt: iapData.receipt,
        iapTransactionId: iapData.transactionId,
        iapProductId: iapData.productId,
      }),
    };

    logger.log('[SignUp] Sending signup request with data:', {
      email: signupData.email,
      tier: signupData.subscriptionTier,
      signupPlatform: signupData.signupPlatform,
      hasIapPlatform: !!signupData.iapPlatform,
      iapPlatform: signupData.iapPlatform,
      hasIapReceipt: !!signupData.iapReceipt,
      iapReceiptLength: signupData.iapReceipt?.length || 0,
      iapTransactionId: signupData.iapTransactionId,
      iapProductId: signupData.iapProductId,
    });

    const response = await fetch(`${config.apiUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signupData),
    });

    const data = await response.json();

    logger.log('[SignUp] Signup response status:', response.status);
    logger.log('[SignUp] Signup response:', JSON.stringify(data, null, 2));

    if (!response.ok) {
      logger.error('[SignUp] Signup failed:', data.message || data.error);
      throw new Error(data.message || t('failedToCreateAccount'));
    }

    logger.log('[SignUp] ========== ACCOUNT CREATED SUCCESSFULLY ==========');
    return true;
  };

  // Handle Pro plan purchase with IAP
  // Note: Account is already created at this point (as starter tier)
  // The Google webhook will update the subscription to pro when purchase is confirmed
  const handleProPurchase = async () => {
    if (!iapProduct) {
      Alert.alert(
        t('subscriptionNotAvailableTitle'),
        t('subscriptionNotAvailableMessage'),
        [
          { text: tc('tryAgain'), onPress: () => handleSignUp() },
          { text: t('useStarter'), onPress: () => {
            updateField('selectedPlan', 'starter');
          }},
        ]
      );
      return;
    }

    setIsPurchasing(true);

    try {
      logger.log('[SignUp] ========== STARTING IAP PURCHASE ==========');
      logger.log('[SignUp] Product ID:', iapProduct.productId);
      logger.log('[SignUp] Account already created, webhook will update subscription');

      await iapService.purchaseSubscription(iapProduct.productId, async (result) => {
        setIsPurchasing(false);

        logger.log('[SignUp] IAP purchase callback received');
        logger.log('[SignUp] Result success:', result.success);
        logger.log('[SignUp] Result transactionId:', result.transactionId);
        logger.log('[SignUp] Result productId:', result.productId);

        if (result.success) {
          logger.log('[SignUp] ========== IAP PURCHASE SUCCESSFUL ==========');
          logger.log('[SignUp] Transaction ID:', result.transactionId);
          logger.log('[SignUp] Product ID:', result.productId);
          logger.log('[SignUp] Receipt/PurchaseToken:', result.receipt?.substring(0, 30) + '...');

          // Sign in first, then link the purchase token
          setIsLoading(true);
          try {
            const email = formData.email.trim().toLowerCase();
            await signIn(email, formData.password);

            // Store credentials for biometric login (replaces any previous account's credentials)
            await storeCredentials(email, formData.password);

            // Now link the IAP purchase so webhook can find the subscription
            // On Android, the receipt is the purchaseToken
            // On iOS, we use the transactionId
            const platform = Platform.OS === 'ios' ? 'ios' : 'android';
            logger.log('[SignUp] Linking IAP purchase to subscription...');

            try {
              await authService.linkIapPurchase({
                platform,
                purchaseToken: result.receipt || result.transactionId || '',
                transactionId: result.transactionId,
                productId: result.productId,
              });
              logger.log('[SignUp] IAP purchase linked successfully');
            } catch (linkError: any) {
              // Don't fail the signup if linking fails - webhook might still work
              logger.error('[SignUp] Failed to link IAP purchase (non-fatal):', linkError.message);
            }
          } catch (error: any) {
            setIsLoading(false);
            Alert.alert(t('errorAlertTitle'), error.message || t('failedToSignIn'));
          }
        } else {
          if (result.error !== 'Purchase cancelled') {
            Alert.alert(t('purchaseFailedTitle'), result.error || t('purchaseFailedMessage'));
          }
        }
      });
    } catch (error: any) {
      setIsPurchasing(false);
      logger.error('[SignUp] IAP purchase error:', error);
      Alert.alert(t('errorAlertTitle'), t('unableToStartPurchase'));
    }
  };

  // Handle sign up (called from plan step)
  // Note: Account is already created at this point (created after business step)
  const handleSignUp = async () => {
    setIsLoading(true);
    try {
      if (formData.selectedPlan === 'pro') {
        setIsLoading(false);
        // Start IAP purchase flow - webhook will update subscription
        await handleProPurchase();
        return;
      }

      // Starter plan - account already created, just sign in
      logger.log('[SignUp] Starter plan selected, signing in...');
      const email = formData.email.trim().toLowerCase();
      await signIn(email, formData.password);

      // Store credentials for biometric login (replaces any previous account's credentials)
      await storeCredentials(email, formData.password);

    } catch (error: any) {
      logger.error('Sign up error:', error);
      Alert.alert(t('errorAlertTitle'), error.message || t('failedToSignIn'));
    } finally {
      setIsLoading(false);
    }
  };

  // Render account step
  const renderAccountStep = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepTitleRow}>
        <View style={styles.stepTitleIcon}>
          <Ionicons name="person-add-outline" size={20} color={colors.primary} />
        </View>
        <Text maxFontSizeMultiplier={1.2} style={styles.stepTitle}>{t('createYourAccount')}</Text>
      </View>
      <Text maxFontSizeMultiplier={1.5} style={styles.stepSubtitle}>
        {t('createYourAccountSubtitle')}
      </Text>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text maxFontSizeMultiplier={1.5} style={styles.label}>{t('emailLabel')}</Text>
          <Input
            icon="mail-outline"
            value={formData.email}
            onChangeText={onChangeEmail}
            placeholder={t('emailPlaceholder')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="none"
            editable={!isFormDisabled}
            error={errors.email}
            accessibilityLabel={t('emailAccessibilityLabel')}
            rightIcon={isCheckingEmail ? (
              <View style={styles.inputSpinner}>
                <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={t('checkingEmailAccessibilityLabel')} />
              </View>
            ) : undefined}
          />
          {errors.email && <Text maxFontSizeMultiplier={1.5} style={styles.errorText} accessibilityRole="alert">{errors.email}</Text>}
        </View>

        <View style={styles.inputGroup}>
          <Text maxFontSizeMultiplier={1.5} style={styles.label}>{t('passwordLabel')}</Text>
          <Input
            icon="lock-closed-outline"
            value={formData.password}
            onChangeText={onChangePassword}
            placeholder={t('passwordPlaceholderSignUp')}
            secureTextEntry={!showPassword}
            textContentType="none"
            editable={!isFormDisabled}
            error={errors.password}
            accessibilityLabel={t('passwordAccessibilityLabel')}
            accessibilityHint={t('passwordAccessibilityHint')}
            rightIcon={passwordRightIcon}
          />
          {errors.password && <Text maxFontSizeMultiplier={1.5} style={styles.errorText} accessibilityRole="alert">{errors.password}</Text>}
        </View>

        <View style={styles.inputGroup}>
          <Text maxFontSizeMultiplier={1.5} style={styles.label}>{t('confirmPasswordLabel')}</Text>
          <Input
            icon="lock-closed-outline"
            value={formData.confirmPassword}
            onChangeText={onChangeConfirmPassword}
            placeholder={t('confirmPasswordPlaceholder')}
            secureTextEntry={!showPassword}
            textContentType="none"
            editable={!isFormDisabled}
            error={errors.confirmPassword}
            accessibilityLabel={t('confirmPasswordAccessibilityLabel')}
          />
          {errors.confirmPassword && <Text maxFontSizeMultiplier={1.5} style={styles.errorText} accessibilityRole="alert">{errors.confirmPassword}</Text>}
        </View>
      </View>
    </View>
  );

  // Render business step
  const renderBusinessStep = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepTitleRow}>
        <View style={styles.stepTitleIcon}>
          <Ionicons name="storefront-outline" size={20} color={colors.primary} />
        </View>
        <Text maxFontSizeMultiplier={1.2} style={styles.stepTitle}>{t('tellUsAboutBusiness')}</Text>
      </View>
      <Text maxFontSizeMultiplier={1.5} style={styles.stepSubtitle}>
        {t('tellUsAboutBusinessSubtitle')}
      </Text>

      <View style={styles.form}>
        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
            <Text maxFontSizeMultiplier={1.5} style={styles.label}>{t('firstNameLabel')}</Text>
            <Input
              icon="person-outline"
              value={formData.firstName}
              onChangeText={onChangeFirstName}
              placeholder={t('firstNamePlaceholder')}
              autoCapitalize="words"
              autoComplete="given-name"
              textContentType="none"
              editable={!isFormDisabled}
              error={errors.firstName}
              accessibilityLabel={t('firstNameAccessibilityLabel')}
            />
            {errors.firstName && <Text maxFontSizeMultiplier={1.5} style={styles.errorText} accessibilityRole="alert">{errors.firstName}</Text>}
          </View>

          <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
            <Text maxFontSizeMultiplier={1.5} style={styles.label}>{t('lastNameLabel')}</Text>
            <Input
              value={formData.lastName}
              onChangeText={onChangeLastName}
              placeholder={t('lastNamePlaceholder')}
              autoCapitalize="words"
              autoComplete="family-name"
              textContentType="none"
              editable={!isFormDisabled}
              error={errors.lastName}
              accessibilityLabel={t('lastNameAccessibilityLabel')}
            />
            {errors.lastName && <Text maxFontSizeMultiplier={1.5} style={styles.errorText} accessibilityRole="alert">{errors.lastName}</Text>}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text maxFontSizeMultiplier={1.5} style={styles.label}>{t('businessNameLabel')}</Text>
          <Input
            icon="storefront-outline"
            value={formData.businessName}
            onChangeText={onChangeBusinessName}
            placeholder={t('businessNamePlaceholder')}
            autoCapitalize="words"
            autoComplete="organization"
            textContentType="none"
            editable={!isFormDisabled}
            error={errors.businessName}
            accessibilityLabel={t('businessNameAccessibilityLabel')}
          />
          {errors.businessName && <Text maxFontSizeMultiplier={1.5} style={styles.errorText} accessibilityRole="alert">{errors.businessName}</Text>}
        </View>

        <View style={styles.inputGroup}>
          <Text maxFontSizeMultiplier={1.5} style={styles.label}>{t('businessTypeLabel')}</Text>
          <TouchableOpacity
            style={[
              styles.selectButton,
              errors.businessType && styles.selectButtonError,
              isFormDisabled && styles.selectButtonDisabled,
            ]}
            onPress={() => {
              Keyboard.dismiss();
              setShowBusinessTypePicker(true);
            }}
            disabled={isFormDisabled}
            accessibilityRole="button"
            accessibilityLabel={formData.businessType ? t('businessTypeAccessibilityLabel', { businessType: formData.businessType }) : t('selectBusinessType')}
            accessibilityHint={t('businessTypeAccessibilityHint')}
            accessibilityState={{ disabled: isFormDisabled }}
          >
            <Ionicons name="briefcase-outline" size={20} color={colors.textSecondary} />
            <Text maxFontSizeMultiplier={1.3} style={[
              styles.selectButtonText,
              !formData.businessType && styles.selectButtonPlaceholder,
            ]}>
              {formData.businessType || t('selectBusinessType')}
            </Text>
            <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          {errors.businessType && <Text maxFontSizeMultiplier={1.5} style={styles.errorText} accessibilityRole="alert">{errors.businessType}</Text>}
        </View>

        <View style={styles.inputGroup}>
          <Text maxFontSizeMultiplier={1.5} style={styles.label}>{t('countryLabel')}</Text>
          <TouchableOpacity
            style={[
              styles.selectButton,
              isFormDisabled && styles.selectButtonDisabled,
            ]}
            onPress={() => {
              Keyboard.dismiss();
              setShowCountryPicker(true);
            }}
            disabled={isFormDisabled}
            accessibilityRole="button"
            accessibilityLabel={t('countryAccessibilityLabel', { countryName: SUPPORTED_COUNTRIES.find(c => c.code === formData.country)?.i18nKey ? t(SUPPORTED_COUNTRIES.find(c => c.code === formData.country)!.i18nKey) : formData.country })}
            accessibilityHint={t('countryAccessibilityHint')}
            accessibilityState={{ disabled: isFormDisabled }}
          >
            <Ionicons name="globe-outline" size={20} color={colors.textSecondary} />
            <Text maxFontSizeMultiplier={1.3} style={styles.selectButtonText}>
              {(() => { const country = SUPPORTED_COUNTRIES.find(c => c.code === formData.country); return country ? t(country.i18nKey) : t('selectCountry'); })()}
            </Text>
            <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={styles.inputGroup}>
          <Text maxFontSizeMultiplier={1.5} style={styles.label}>{t('phoneLabel')}</Text>
          <PhoneInput
            value={phoneInputValue}
            onChangePhoneNumber={phoneOnChange}
            selectedCountry={selectedCountry}
            onChangeSelectedCountry={phoneOnChangeCountry}
            defaultCountry={formData.country as any}
            placeholder={t('phonePlaceholder')}
            disabled={isFormDisabled}
            theme={isDark ? 'dark' : 'light'}
            phoneInputStyles={{
              container: styles.phoneContainer,
              flagContainer: styles.phoneFlagContainer,
              callingCode: styles.phoneCode,
              input: styles.phoneInput,
              divider: styles.phoneDivider,
              caret: styles.phoneCaret,
            }}
            modalStyles={isDark ? {
              content: { backgroundColor: colors.card },
              searchInput: { backgroundColor: colors.background, borderColor: colors.border, color: colors.text },
              countryItem: { backgroundColor: colors.background, borderColor: colors.border },
              closeButton: { backgroundColor: colors.background, borderColor: colors.border },
            } : undefined}
          />
          {errors.phone && <Text maxFontSizeMultiplier={1.5} style={styles.errorText} accessibilityRole="alert">{errors.phone}</Text>}
        </View>

        <TouchableOpacity
          style={[styles.checkboxRow, isFormDisabled && styles.checkboxRowDisabled]}
          onPress={() => updateField('acceptTerms', !formData.acceptTerms)}
          activeOpacity={0.7}
          disabled={isFormDisabled}
          accessibilityRole="checkbox"
          accessibilityLabel={t('agreeToTermsAccessibilityLabel')}
          accessibilityState={{ checked: formData.acceptTerms, disabled: isFormDisabled }}
        >
          <View style={[
            styles.checkbox,
            formData.acceptTerms && styles.checkboxChecked,
            errors.acceptTerms && styles.checkboxError,
          ]}>
            {formData.acceptTerms && (
              <Ionicons name="checkmark" size={14} color="#fff" />
            )}
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.checkboxLabel}>
            {t('agreeToTerms')}
            <Text
              maxFontSizeMultiplier={1.3}
              style={styles.link}
              onPress={(e) => {
                e.stopPropagation();
                Linking.openURL(`${config.websiteUrl}/terms`);
              }}
              suppressHighlighting
              accessibilityRole="link"
              accessibilityLabel={t('termsOfServiceAccessibilityLabel')}
              accessibilityHint={t('termsOfServiceAccessibilityHint')}
            >
              {t('termsOfService')}
            </Text>
            {tc('and')}
            <Text
              maxFontSizeMultiplier={1.3}
              style={styles.link}
              onPress={(e) => {
                e.stopPropagation();
                Linking.openURL(`${config.websiteUrl}/privacy`);
              }}
              suppressHighlighting
              accessibilityRole="link"
              accessibilityLabel={t('privacyPolicyAccessibilityLabel')}
              accessibilityHint={t('privacyPolicyAccessibilityHint')}
            >
              {t('privacyPolicy')}
            </Text>
          </Text>
        </TouchableOpacity>
        {errors.acceptTerms && <Text maxFontSizeMultiplier={1.5} style={styles.errorText} accessibilityRole="alert">{errors.acceptTerms}</Text>}
      </View>

      {/* Business Type Picker Modal */}
      {showBusinessTypePicker && (
        <View style={styles.pickerOverlay}>
          <TouchableOpacity
            style={styles.pickerBackdrop}
            onPress={() => setShowBusinessTypePicker(false)}
            accessibilityRole="button"
            accessibilityLabel={t('closeBusinessTypePicker')}
          />
          <View style={styles.pickerContent}>
            <View style={styles.pickerHeader}>
              <Text maxFontSizeMultiplier={1.3} style={styles.pickerTitle}>{t('selectBusinessTypePickerTitle')}</Text>
              <TouchableOpacity onPress={() => setShowBusinessTypePicker(false)} accessibilityRole="button" accessibilityLabel={t('closeAccessibilityLabel')}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerList}>
              {BUSINESS_TYPE_KEYS.map((key) => {
                const label = t(key);
                return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.pickerOption,
                    formData.businessType === label && styles.pickerOptionSelected,
                  ]}
                  onPress={() => {
                    updateField('businessType', label);
                    setShowBusinessTypePicker(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: formData.businessType === label }}
                >
                  <Text maxFontSizeMultiplier={1.3} style={[
                    styles.pickerOptionText,
                    formData.businessType === label && styles.pickerOptionTextSelected,
                  ]}>
                    {label}
                  </Text>
                  {formData.businessType === label && (
                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      )}

      {/* Country Picker Modal */}
      {showCountryPicker && (
        <View style={styles.pickerOverlay}>
          <TouchableOpacity
            style={styles.pickerBackdrop}
            onPress={() => setShowCountryPicker(false)}
            accessibilityRole="button"
            accessibilityLabel={t('closeCountryPicker')}
          />
          <View style={styles.pickerContent}>
            <View style={styles.pickerHeader}>
              <Text maxFontSizeMultiplier={1.3} style={styles.pickerTitle}>{t('selectCountryPickerTitle')}</Text>
              <TouchableOpacity onPress={() => setShowCountryPicker(false)} accessibilityRole="button" accessibilityLabel={t('closeAccessibilityLabel')}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerList}>
              {SUPPORTED_COUNTRIES.map((country) => {
                const countryName = t(country.i18nKey);
                return (
                <TouchableOpacity
                  key={country.code}
                  style={[
                    styles.pickerOption,
                    formData.country === country.code && styles.pickerOptionSelected,
                  ]}
                  onPress={() => {
                    updateField('country', country.code);
                    setShowCountryPicker(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={countryName}
                  accessibilityState={{ selected: formData.country === country.code }}
                >
                  <Text maxFontSizeMultiplier={1.3} style={[
                    styles.pickerOptionText,
                    formData.country === country.code && styles.pickerOptionTextSelected,
                  ]}>
                    {countryName}
                  </Text>
                  {formData.country === country.code && (
                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );

  // Render plan step
  const renderPlanStep = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepTitleRow}>
        <View style={styles.stepTitleIcon}>
          <Ionicons name="rocket-outline" size={20} color={colors.primary} />
        </View>
        <Text maxFontSizeMultiplier={1.2} style={styles.stepTitle}>{t('chooseYourPlan')}</Text>
      </View>
      <Text maxFontSizeMultiplier={1.5} style={styles.stepSubtitle}>
        {t('chooseYourPlanSubtitle')}
      </Text>

      <View style={styles.plansContainer}>
        {/* Starter Plan */}
        <TouchableOpacity
          style={[
            styles.planCard,
            formData.selectedPlan === 'starter' && styles.planCardSelected,
            isFormDisabled && styles.planCardDisabled,
          ]}
          onPress={() => updateField('selectedPlan', 'starter')}
          disabled={isFormDisabled}
          accessibilityRole="radio"
          accessibilityLabel={t('starterPlanAccessibilityLabel', { price: t('starterPlanPrice'), transactionFee: getTTPDisplayRate(formData.country, 'starter') })}
          accessibilityState={{ selected: formData.selectedPlan === 'starter', disabled: isFormDisabled }}
        >
          <View style={styles.planHeader}>
            <Text maxFontSizeMultiplier={1.3} style={styles.planName}>{t('starterPlanName')}</Text>
            <View style={styles.planPriceRow}>
              <Text maxFontSizeMultiplier={1.2} style={styles.planPrice}>{t('starterPlanPrice')}</Text>
            </View>
            <Text maxFontSizeMultiplier={1.3} style={styles.planPriceSubtext}>{t('starterPlanPriceSubtext')}</Text>
          </View>

          <View style={styles.planFee}>
            <Text maxFontSizeMultiplier={1.3} style={styles.planFeeLabel}>{t('transactionFeeLabel')}</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.planFeeValue}>{getTTPDisplayRate(formData.country, 'starter')}</Text>
          </View>

          <View style={styles.planFeatures}>
            {STARTER_FEATURE_KEYS.map((key, index) => (
              <View key={index} style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text maxFontSizeMultiplier={1.3} style={styles.featureText}>{t(key)}</Text>
              </View>
            ))}
            {STARTER_NOT_INCLUDED_KEYS.map((key, index) => (
              <View key={`not-${index}`} style={styles.featureRow}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                <Text maxFontSizeMultiplier={1.3} style={[styles.featureText, styles.featureTextMuted]}>{t(key)}</Text>
              </View>
            ))}
          </View>

          {formData.selectedPlan === 'starter' && (
            <View style={styles.selectedBadge}>
              <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
              <Text maxFontSizeMultiplier={1.3} style={styles.selectedBadgeText}>{t('selectedBadge')}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Pro Plan */}
        <TouchableOpacity
          style={[
            styles.planCard,
            styles.planCardPro,
            formData.selectedPlan === 'pro' && styles.planCardSelected,
            isFormDisabled && styles.planCardDisabled,
          ]}
          onPress={() => updateField('selectedPlan', 'pro')}
          disabled={isFormDisabled}
          accessibilityRole="radio"
          accessibilityLabel={t('proPlanAccessibilityLabel', { price: iapProduct?.localizedPrice || PRICING.pro.monthlyPriceDisplay, transactionFee: getTTPDisplayRate(formData.country, 'pro') })}
          accessibilityState={{ selected: formData.selectedPlan === 'pro', disabled: isFormDisabled }}
        >
          <View style={styles.popularBadge}>
            <Text maxFontSizeMultiplier={1.3} style={styles.popularBadgeText}>{t('mostPopularBadge')}</Text>
          </View>

          <View style={styles.planHeader}>
            <Text maxFontSizeMultiplier={1.3} style={styles.planName}>{t('proPlanName')}</Text>
            <View style={styles.planPriceRow}>
              <Text maxFontSizeMultiplier={1.2} style={styles.planPrice}>
                {iapProduct?.localizedPrice || PRICING.pro.monthlyPriceDisplay}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.3} style={styles.planPriceSubtext}>{t('proPlanPriceSubtext')}</Text>
          </View>

          <View style={styles.planFee}>
            <Text maxFontSizeMultiplier={1.3} style={styles.planFeeLabel}>{t('transactionFeeLabel')}</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.planFeeValue}>{getTTPDisplayRate(formData.country, 'pro')}</Text>
          </View>

          <View style={styles.planFeatures}>
            {PRO_FEATURE_KEYS.map((key, index) => (
              <View key={index} style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text maxFontSizeMultiplier={1.3} style={styles.featureText}>{t(key)}</Text>
              </View>
            ))}
          </View>

          {formData.selectedPlan === 'pro' && (
            <View style={styles.selectedBadge}>
              <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
              <Text maxFontSizeMultiplier={1.3} style={styles.selectedBadgeText}>{t('selectedBadge')}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.legalLinks}>
        <TouchableOpacity
          onPress={() => Linking.openURL(`${config.websiteUrl}/terms`)}
          accessibilityRole="link"
          accessibilityLabel={t('termsOfUseAccessibilityLabel')}
        >
          <Text style={styles.legalLinkText} maxFontSizeMultiplier={1.5}>{t('termsOfUse')}</Text>
        </TouchableOpacity>
        <Text style={styles.legalLinkSeparator} maxFontSizeMultiplier={1.5}>{t('legalSeparator')}</Text>
        <TouchableOpacity
          onPress={() => Linking.openURL(`${config.websiteUrl}/privacy`)}
          accessibilityRole="link"
          accessibilityLabel={t('privacyPolicyAccessibilityLabel')}
        >
          <Text style={styles.legalLinkText} maxFontSizeMultiplier={1.5}>{t('privacyPolicy')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // Render confirmation step
  const renderConfirmationStep = () => (
    <View style={styles.confirmationContent}>
      {/* Success Icon */}
      <View style={styles.successIconWrapper}>
        <View style={styles.successIconGlow} />
        <View style={styles.successIconOuter}>
          <View style={styles.successIconInner}>
            <Ionicons name="checkmark" size={40} color="#fff" />
          </View>
        </View>
      </View>

      <Text maxFontSizeMultiplier={1.2} style={styles.confirmationTitle}>{t('welcomeToRowie')}</Text>
      <Text maxFontSizeMultiplier={1.5} style={styles.confirmationSubtitle}>
        {t('accountCreatedSuccessfully')}
      </Text>

      <View style={styles.confirmationChecklist}>
        <View style={styles.checklistItem}>
          <View style={styles.checklistIconWrapper}>
            <Ionicons name="checkmark" size={14} color={colors.success} />
          </View>
          <Text maxFontSizeMultiplier={1.5} style={styles.checklistText}>{t('accountCreated')}</Text>
        </View>
        <View style={styles.checklistItem}>
          <View style={styles.checklistIconWrapper}>
            <Ionicons name="checkmark" size={14} color={colors.success} />
          </View>
          <Text maxFontSizeMultiplier={1.5} style={styles.checklistText}>
            {formData.selectedPlan === 'pro' ? t('proPlanActivated') : t('starterPlanActivated')}
          </Text>
        </View>
        <View style={styles.checklistItem}>
          <View style={[styles.checklistIconWrapper, styles.checklistIconLoading]}>
            <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={t('signingYouInAccessibilityLabel')} />
          </View>
          <Text maxFontSizeMultiplier={1.5} style={styles.checklistText}>{t('signingYouIn')}</Text>
        </View>
      </View>

      {/* Next Steps */}
      <View style={styles.nextStepsContainer}>
        <Text maxFontSizeMultiplier={1.5} style={styles.nextStepsTitle}>{t('nextStep')}</Text>
        <View style={styles.nextStepsCard}>
          <View style={styles.nextStepsIconContainer}>
            <Ionicons name="wallet-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.nextStepsContent}>
            <Text maxFontSizeMultiplier={1.5} style={styles.nextStepsHeading}>{t('linkBankAccount')}</Text>
            <Text maxFontSizeMultiplier={1.5} style={styles.nextStepsDescription}>
              {t('linkBankAccountDescription')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.screenBackground}>
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Header */}
        <View style={styles.header}>
          {currentStep !== 'confirmation' ? (
            <TouchableOpacity onPress={handleBack} style={styles.backButton} accessibilityRole="button" accessibilityLabel={t('goBackAccessibilityLabel')}>
              <View style={styles.backButtonInner}>
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.backButton} />
          )}

          {/* Step Indicators */}
          {currentStep !== 'confirmation' ? (
            <View style={styles.stepIndicators}>
              {STEP_CONFIG.map((step, index) => {
                const isActive = STEPS.indexOf(currentStep) >= index;
                const isCurrent = currentStep === step.key;
                return (
                  <View key={step.key} style={styles.stepIndicatorWrapper}>
                    <View style={[
                      styles.stepIndicator,
                      isActive && styles.stepIndicatorActive,
                      isCurrent && styles.stepIndicatorCurrent,
                    ]}>
                      <Ionicons
                        name={step.icon as any}
                        size={16}
                        color={isActive ? '#fff' : colors.textMuted}
                      />
                    </View>
                    {index < STEP_CONFIG.length - 1 && (
                      <View style={[
                        styles.stepConnector,
                        isActive && styles.stepConnectorActive,
                      ]} />
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text maxFontSizeMultiplier={1.5} style={styles.stepLabel}>{t('signUpStepCompleteLabel')}</Text>
          )}

          <View style={styles.backButton} />
        </View>

        {/* Progress Bar */}
        {currentStep !== 'confirmation' && (
          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  { width: progressWidth },
                ]}
              />
            </View>
          </View>
        )}

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            onScrollBeginDrag={Keyboard.dismiss}
          >
            <Pressable onPress={Keyboard.dismiss} accessible={false}>
              {currentStep === 'account' && <View key="account">{renderAccountStep()}</View>}
              {currentStep === 'business' && <View key="business">{renderBusinessStep()}</View>}
              {currentStep === 'plan' && <View key="plan">{renderPlanStep()}</View>}
              {currentStep === 'confirmation' && <View key="confirmation">{renderConfirmationStep()}</View>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Footer with button */}
        {currentStep !== 'confirmation' && (
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.nextButton, (isLoading || isPurchasing) && styles.buttonDisabled]}
              onPress={handleNext}
              disabled={isLoading || isCheckingEmail || isCheckingPassword || isPurchasing}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={
                isLoading || isPurchasing
                  ? (isPurchasing ? t('processingPurchaseAccessibilityLabel') : t('creatingAccountAccessibilityLabel'))
                  : currentStep === 'plan'
                    ? formData.selectedPlan === 'pro'
                      ? t('subscribeToPro')
                      : t('createAccountButton')
                    : t('continueButton')
              }
              accessibilityState={{ disabled: isLoading || isCheckingEmail || isCheckingPassword || isPurchasing, busy: isLoading || isPurchasing }}
            >
              <View style={styles.nextButtonInner}>
                {isLoading || isPurchasing ? (
                  <View style={styles.buttonLoadingContent}>
                    <ActivityIndicator color="#fff" size="small" accessibilityLabel={isPurchasing ? t('processingPurchaseAccessibilityLabel') : t('creatingAccountAccessibilityLabel')} />
                    <Text maxFontSizeMultiplier={1.3} style={styles.nextButtonText}>
                      {isPurchasing ? t('processingButton') : t('creatingAccountButton')}
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text maxFontSizeMultiplier={1.3} style={styles.nextButtonText}>
                      {currentStep === 'plan'
                        ? formData.selectedPlan === 'pro'
                          ? t('subscribeToPro')
                          : t('createAccountButton')
                        : t('continueButton')}
                    </Text>
                    <Ionicons name="arrow-forward" size={20} color="#fff" />
                  </>
                )}
              </View>
            </TouchableOpacity>

            {currentStep === 'account' && (
              <View style={styles.signInRow}>
                <Text maxFontSizeMultiplier={1.5} style={styles.signInText}>{t('alreadyHaveAccount')}</Text>
                <TouchableOpacity onPress={() => navigation.goBack()} accessibilityRole="link" accessibilityLabel={t('signInAccessibilityLabelLink')}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.signInLink}>{t('signInLink')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const createStyles = (colors: any, isDark: boolean) =>
  StyleSheet.create({
    screenBackground: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    backButton: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backButtonInner: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepIndicators: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    stepIndicatorWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    stepIndicator: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepIndicatorActive: {
      backgroundColor: colors.primary + '30',
      borderColor: colors.primary + '50',
    },
    stepIndicatorCurrent: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
      ...shadows.sm,
      shadowColor: colors.primary,
      shadowOpacity: 0.4,
    },
    stepConnector: {
      width: 24,
      height: 2,
      backgroundColor: colors.border,
      marginHorizontal: 4,
    },
    stepConnectorActive: {
      backgroundColor: colors.primary + '50',
    },
    stepLabel: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
      color: colors.textSecondary,
    },
    progressContainer: {
      paddingHorizontal: 20,
      paddingBottom: 20,
    },
    progressTrack: {
      height: 3,
      backgroundColor: colors.border,
      borderRadius: 2,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: colors.primary,
      borderRadius: 2,
    },
    keyboardView: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 20,
    },
    stepContent: {
      flex: 1,
    },
    stepTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 8,
    },
    stepTitleIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: colors.primary + '15',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepTitle: {
      fontSize: 24,
      fontFamily: fonts.bold,
      color: colors.text,
      flex: 1,
    },
    stepSubtitle: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      marginBottom: 28,
      lineHeight: 22,
      marginLeft: 52,
    },
    form: {
      gap: 20,
    },
    inputGroup: {
      gap: 8,
    },
    label: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
      marginLeft: 4,
    },
    errorText: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.error,
      marginLeft: 4,
      marginTop: 4,
    },
    eyeButton: {
      position: 'absolute',
      right: 12,
      padding: 8,
    },
    inputSpinner: {
      position: 'absolute',
      right: 16,
      padding: 4,
    },
    row: {
      flexDirection: 'row',
    },
    selectButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(41, 37, 36, 0.5)',
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.gray700,
      paddingHorizontal: 16,
      paddingVertical: 16,
      gap: 12,
    },
    selectButtonError: {
      borderColor: colors.error,
    },
    selectButtonDisabled: {
      opacity: 0.5,
    },
    selectButtonText: {
      flex: 1,
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.text,
    },
    selectButtonPlaceholder: {
      color: colors.textMuted,
    },
    checkboxRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    checkboxRowDisabled: {
      opacity: 0.5,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    checkboxChecked: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    checkboxError: {
      borderColor: colors.error,
    },
    checkboxLabel: {
      flex: 1,
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      lineHeight: 22,
    },
    link: {
      color: colors.primary,
      fontFamily: fonts.medium,
    },
    // Picker styles
    pickerOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'flex-end',
    },
    pickerBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    pickerContent: {
      backgroundColor: isDark ? '#292524' : '#ffffff',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      maxHeight: '60%',
    },
    pickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    pickerTitle: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    pickerList: {
      paddingTop: 8,
      paddingBottom: 24,
    },
    pickerOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 16,
    },
    pickerOptionSelected: {
      backgroundColor: colors.primary + '15',
    },
    pickerOptionText: {
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.text,
    },
    pickerOptionTextSelected: {
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    // Plan styles
    plansContainer: {
      gap: 16,
    },
    planCard: {
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 2,
      borderColor: colors.border,
      padding: 20,
      ...shadows.sm,
    },
    planCardPro: {
      borderColor: colors.primary + '40',
    },
    planCardSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + '08',
    },
    planCardDisabled: {
      opacity: 0.5,
    },
    popularBadge: {
      position: 'absolute',
      top: -12,
      right: 20,
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 12,
    },
    popularBadgeText: {
      fontSize: 12,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },
    planHeader: {
      marginBottom: 16,
    },
    planName: {
      fontSize: 22,
      fontFamily: fonts.bold,
      color: colors.text,
      marginBottom: 8,
    },
    planPriceRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    planPrice: {
      fontSize: 32,
      fontFamily: fonts.bold,
      color: colors.text,
    },
    planPriceOriginal: {
      fontSize: 18,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      textDecorationLine: 'line-through',
    },
    planPriceSubtext: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      marginTop: 2,
    },
    trialBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 8,
      backgroundColor: colors.primary + '15',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      alignSelf: 'flex-start',
    },
    trialBadgeText: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.primary,
    },
    planFee: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 12,
      marginBottom: 16,
    },
    planFeeLabel: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
    },
    planFeeValue: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    planFeatures: {
      gap: 10,
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    featureText: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.text,
      flex: 1,
    },
    featureTextMuted: {
      color: colors.textMuted,
    },
    selectedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 16,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    selectedBadgeText: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    legalLinks: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 16,
    },
    legalLinkText: {
      fontSize: 12,
      fontFamily: fonts.medium,
      color: colors.primary,
    },
    legalLinkSeparator: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },
    // Confirmation styles
    confirmationContent: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 40,
    },
    successIconWrapper: {
      position: 'relative',
      marginBottom: 28,
    },
    successIconGlow: {
      position: 'absolute',
      top: -10,
      left: -10,
      right: -10,
      bottom: -10,
      borderRadius: 50,
      backgroundColor: colors.success,
      opacity: 0.15,
    },
    successIconOuter: {
      width: 80,
      height: 80,
      borderRadius: 24,
      overflow: 'hidden',
      ...shadows.lg,
      shadowColor: colors.success,
      shadowOpacity: 0.4,
    },
    successIconInner: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.success,
      borderRadius: 24,
    },
    confirmationTitle: {
      fontSize: 28,
      fontFamily: fonts.bold,
      color: colors.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    confirmationSubtitle: {
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      marginBottom: 32,
      textAlign: 'center',
    },
    confirmationChecklist: {
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 20,
      width: '100%',
      gap: 14,
    },
    checklistItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    checklistIconWrapper: {
      width: 28,
      height: 28,
      borderRadius: 8,
      backgroundColor: colors.success + '15',
      alignItems: 'center',
      justifyContent: 'center',
    },
    checklistIconLoading: {
      backgroundColor: colors.primary + '15',
    },
    checklistText: {
      fontSize: 16,
      fontFamily: fonts.medium,
      color: colors.text,
    },
    // Next Steps styles
    nextStepsContainer: {
      width: '100%',
      marginTop: 24,
    },
    nextStepsTitle: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 12,
    },
    nextStepsCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 14,
    },
    nextStepsIconContainer: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: colors.primary + '15',
      alignItems: 'center',
      justifyContent: 'center',
    },
    nextStepsContent: {
      flex: 1,
    },
    nextStepsHeading: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.text,
      marginBottom: 4,
    },
    nextStepsDescription: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    // Footer styles
    footer: {
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 24,
    },
    nextButton: {
      borderRadius: 20,
      overflow: 'hidden',
      ...shadows.md,
    },
    nextButtonInner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 18,
      backgroundColor: colors.primary,
      borderRadius: 20,
    },
    nextButtonText: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonLoadingContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    signInRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 16,
    },
    signInText: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
    },
    signInLink: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    // Phone input styles
    phoneContainer: {
      backgroundColor: isDark ? 'rgba(41, 37, 36, 0.5)' : '#FFFFFF',
      borderRadius: 12,
      borderWidth: isDark ? 2 : 1,
      borderColor: colors.border,
    },
    phoneFlagContainer: {
      backgroundColor: isDark ? 'rgba(41, 37, 36, 0.5)' : colors.surfaceSecondary,
      borderTopLeftRadius: 11,
      borderBottomLeftRadius: 11,
    },
    phoneInput: {
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.text,
      height: 48,
    },
    phoneCode: {
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.text,
    },
    phoneDivider: {
      backgroundColor: colors.borderLight,
    },
    phoneCaret: {
      color: colors.textSecondary,
    },
  });
