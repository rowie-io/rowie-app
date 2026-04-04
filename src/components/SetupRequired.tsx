import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Modal,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useTranslations } from '../lib/i18n';
import { useCatalog } from '../context/CatalogContext';
import { catalogsApi, CreateCatalogData, CatalogLayoutType } from '../lib/api';
import { openVendorDashboard } from '../lib/auth-handoff';
import { fonts } from '../lib/fonts';
import { brandGradient, brandGradientLight } from '../lib/colors';
import { LinearGradient } from 'expo-linear-gradient';
import { Toggle } from './Toggle';

const LAYOUT_OPTIONS: { value: CatalogLayoutType; labelKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'classic-grid', labelKey: 'layoutClassicGrid', icon: 'grid-outline' },
  { value: 'split-view', labelKey: 'layoutSplitView', icon: 'browsers-outline' },
  { value: 'list', labelKey: 'layoutList', icon: 'list-outline' },
  { value: 'cards', labelKey: 'layoutCards', icon: 'square-outline' },
  { value: 'mosaic', labelKey: 'layoutMosaic', icon: 'apps-outline' },
  { value: 'compact', labelKey: 'layoutCompact', icon: 'menu-outline' },
];

export type SetupType = 'no-catalogs' | 'no-payment-account';

interface SetupRequiredProps {
  type: SetupType;
  onQuickCharge?: () => void;
}

// Payment account setup - simple version
function PaymentSetupRequired({ colors, isManager }: { colors: any; isManager: boolean }) {
  const t = useTranslations('components.setupRequired');
  const styles = createSimpleStyles(colors);

  return (
    <View style={styles.container} accessibilityRole="alert">
      <View style={styles.iconContainer}>
        <Ionicons name="card-outline" size={48} color={colors.textMuted} />
      </View>
      <Text style={styles.title} maxFontSizeMultiplier={1.2}>{t('paymentSetupTitle')}</Text>
      <Text style={styles.message} maxFontSizeMultiplier={1.5}>
        {isManager
          ? t('paymentSetupMessageManager')
          : t('paymentSetupMessageStaff')}
      </Text>
      {isManager && (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={() => openVendorDashboard('/banking')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('setUpPaymentsLabel')}
          accessibilityHint={t('setUpPaymentsHint')}
        >
          <Ionicons name="card" size={18} color="#fff" />
          <Text style={styles.buttonText} maxFontSizeMultiplier={1.3}>{t('setUpPaymentsLabel')}</Text>
          <Ionicons name="open-outline" size={16} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

// No catalogs - full welcome experience
function NoCatalogsWelcome({ colors, isDark, isManager, onQuickCharge }: { colors: any; isDark: boolean; isManager: boolean; onQuickCharge?: () => void }) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { organization, connectStatus, isPaymentReady } = useAuth();
  const t = useTranslations('components.setupRequired');
  const ts = useTranslations('components.catalogSettings');
  const tc = useTranslations('common');
  const isPaymentConnected = connectStatus?.chargesEnabled === true;
  const { refreshCatalogs, setSelectedCatalog } = useCatalog();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [catalogName, setCatalogName] = useState('');
  const [catalogDescription, setCatalogDescription] = useState('');
  const [catalogLocation, setCatalogLocation] = useState('');
  const [catalogDate, setCatalogDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [taxRateString, setTaxRateString] = useState('0');
  const [layoutType, setLayoutType] = useState<CatalogLayoutType>('classic-grid');
  const [showTipScreen, setShowTipScreen] = useState(true);
  const [tipPercentages, setTipPercentages] = useState<number[]>([15, 18, 20, 25]);
  const [allowCustomTip, setAllowCustomTip] = useState(true);
  const [promptForEmail, setPromptForEmail] = useState(false);
  const [editingTipIndex, setEditingTipIndex] = useState<number | null>(null);
  const [editingTipValue, setEditingTipValue] = useState('');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  // Create catalog mutation
  const createCatalogMutation = useMutation({
    mutationFn: (data: CreateCatalogData) => catalogsApi.create(data),
    onSuccess: async (newCatalog) => {
      // Refresh catalogs and select the new one
      await refreshCatalogs();
      await setSelectedCatalog(newCatalog);
      setShowCreateModal(false);
      // Reset form
      setCatalogName('');
      setCatalogDescription('');
      setCatalogLocation('');
      setCatalogDate(null);
      setTaxRateString('0');
      setLayoutType('classic-grid');
      setShowTipScreen(true);
      setTipPercentages([15, 18, 20, 25]);
      setAllowCustomTip(true);
      setPromptForEmail(false);
    },
    onError: (error: any) => {
      Alert.alert(tc('error'), error.message || t('errorFailedToCreate'));
    },
  });

  const handleCreateCatalog = () => {
    const name = catalogName.trim();
    if (!name) {
      Alert.alert(tc('error'), t('errorMenuNameRequired'));
      return;
    }

    const taxRate = parseFloat(taxRateString) || 0;
    if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
      Alert.alert(tc('error'), t('errorInvalidTaxRate'));
      return;
    }

    createCatalogMutation.mutate({
      name,
      description: catalogDescription.trim() || null,
      location: catalogLocation.trim() || null,
      date: catalogDate ? catalogDate.toISOString().split('T')[0] : null,
      isActive: true,
      showTipScreen,
      tipPercentages,
      allowCustomTip,
      promptForEmail,
      taxRate,
      layoutType,
    });
  };

  // Date picker handlers
  const formatDate = (d: Date | null): string => {
    if (!d) return '';
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (event.type === 'set' && selectedDate) {
      setCatalogDate(selectedDate);
    }
  };

  const handleClearDate = () => {
    setCatalogDate(null);
    setShowDatePicker(false);
  };

  // Tip percentage handlers
  const handleAddTipPercentage = () => {
    if (tipPercentages.length >= 6) {
      Alert.alert(ts('limitReachedTitle'), ts('maxTipPercentages'));
      return;
    }
    const maxTip = Math.max(...tipPercentages, 0);
    const newTip = Math.min(maxTip + 5, 100);
    setTipPercentages([...tipPercentages, newTip]);
  };

  const handleRemoveTipPercentage = (index: number) => {
    if (tipPercentages.length <= 1) {
      Alert.alert(tc('error'), ts('atLeastOneTip'));
      return;
    }
    setTipPercentages(tipPercentages.filter((_, i) => i !== index));
  };

  const handleStartEditTip = (index: number) => {
    setEditingTipIndex(index);
    setEditingTipValue(tipPercentages[index].toString());
  };

  const handleSaveTipEdit = () => {
    if (editingTipIndex === null) return;
    const value = parseInt(editingTipValue, 10);
    if (isNaN(value) || value < 0 || value > 100) {
      Alert.alert(tc('error'), ts('invalidPercentage'));
      return;
    }
    const newPercentages = [...tipPercentages];
    newPercentages[editingTipIndex] = value;
    setTipPercentages(newPercentages.sort((a, b) => a - b));
    setEditingTipIndex(null);
    setEditingTipValue('');
  };

  const handleCancelTipEdit = () => {
    setEditingTipIndex(null);
    setEditingTipValue('');
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const styles = createWelcomeStyles(colors, isDark);

  const handleQuickCharge = () => {
    onQuickCharge?.();
  };

  const handleOpenCreateModal = () => {
    setShowCreateModal(true);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={true}
        overScrollMode="always"
      >
        <Animated.View
          style={[
            styles.headerContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            }
          ]}
        >
          {/* Greeting */}
          <View style={styles.greetingSection}>
            <Text style={[styles.orgName, { color: colors.text }]} maxFontSizeMultiplier={1.2}>
              {organization?.name || t('welcome')}
            </Text>
            <Text style={[styles.welcomeSub, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
              {t('setUpMenuSubtitle')}
            </Text>
          </View>

          {/* Primary CTA — Create Menu */}
          <View style={styles.ctaSection}>
            <TouchableOpacity
              onPress={handleOpenCreateModal}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('createFirstMenuTitle')}
            >
              <LinearGradient
                colors={isDark ? brandGradient : brandGradientLight}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.ctaCard}
              >
                <View style={styles.ctaIconWrap}>
                  <Ionicons name="add-circle" size={32} color="#fff" />
                </View>
                <Text style={styles.ctaTitle} maxFontSizeMultiplier={1.3}>
                  {t('createFirstMenuTitle')}
                </Text>
                <Text style={styles.ctaDesc} maxFontSizeMultiplier={1.5}>
                  {t('createFirstMenuDesc')}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* What's next — steps preview */}
          <View style={styles.stepsSection}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
              {t('whatsNextLabel')}
            </Text>
            <View style={[styles.stepsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {isPaymentConnected ? (
                <View style={styles.stepRow}>
                  <View style={[styles.stepDot, { backgroundColor: colors.success }]} />
                  <View style={styles.stepTextWrap}>
                    <Text style={[styles.stepLabel, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{t('paymentsConnectedLabel')}</Text>
                    <Text style={[styles.stepHint, { color: colors.success }]} maxFontSizeMultiplier={1.5}>{t('bankAccountLinked')}</Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.stepRow}
                  onPress={() => navigation.navigate('StripeOnboarding', { returnTo: 'home' })}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel={t('connectPaymentsLabel')}
                  accessibilityHint={t('linkBankViaStripe')}
                >
                  <LinearGradient colors={isDark ? brandGradient : brandGradientLight} style={styles.stepDot} />
                  <View style={styles.stepTextWrap}>
                    <Text style={[styles.stepLabel, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{t('connectPaymentsLabel')}</Text>
                    <Text style={[styles.stepHint, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>{t('linkBankViaStripe')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
              <View style={[styles.stepDivider, { backgroundColor: colors.divider }]} />
              {isPaymentConnected ? (
                <TouchableOpacity
                  style={styles.stepRow}
                  onPress={handleOpenCreateModal}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel={t('createFirstMenuStepLabel')}
                >
                  <LinearGradient colors={isDark ? brandGradient : brandGradientLight} style={styles.stepDot} />
                  <View style={styles.stepTextWrap}>
                    <Text style={[styles.stepLabel, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{t('createFirstMenuStepLabel')}</Text>
                    <Text style={[styles.stepHint, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>{t('addProductsStartOrders')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              ) : (
                <View style={styles.stepRow}>
                  <View style={[styles.stepDot, { backgroundColor: colors.border }]} />
                  <View style={styles.stepTextWrap}>
                    <Text style={[styles.stepLabel, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{t('createFirstMenuStepLabel')}</Text>
                    <Text style={[styles.stepHint, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>{t('addProductsStartOrders')}</Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Quick Charge + Vendor Portal */}
          <View style={styles.linksSection}>
            <TouchableOpacity
              style={[styles.linkCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: isPaymentReady ? 1 : 0.35 }]}
              onPress={isPaymentReady ? handleQuickCharge : undefined}
              disabled={!isPaymentReady}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('quickChargeLabel')}
              accessibilityState={{ disabled: !isPaymentReady }}
            >
              <View style={[styles.linkIconWrap, { backgroundColor: colors.chipBgActive }]}>
                <Ionicons name="flash" size={18} color={colors.primary} />
              </View>
              <View style={styles.linkTextWrap}>
                <Text style={[styles.linkTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{t('quickChargeLabel')}</Text>
                <Text style={[styles.linkHint, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>{t('quickChargeDesc')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            {isManager && (
              <TouchableOpacity
                style={[styles.linkCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => openVendorDashboard('/products')}
                activeOpacity={0.7}
                accessibilityRole="link"
                accessibilityLabel={t('openVendorPortal')}
              >
                <View style={[styles.linkIconWrap, { backgroundColor: colors.chipBg }]}>
                  <Ionicons name="desktop-outline" size={18} color={colors.textSecondary} />
                </View>
                <View style={styles.linkTextWrap}>
                  <Text style={[styles.linkTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{t('vendorPortalLabel')}</Text>
                  <Text style={[styles.linkHint, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>{t('vendorPortalDesc')}</Text>
                </View>
                <Ionicons name="open-outline" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </ScrollView>

      {/* Create Menu Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalContainer}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowCreateModal(false)} accessibilityLabel={tc('close')} accessibilityRole="button" />
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            {/* Modal Header */}
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity
                onPress={() => setShowCreateModal(false)}
                style={[styles.modalCloseButton, { backgroundColor: colors.card }]}
                accessibilityRole="button"
                accessibilityLabel={tc('close')}
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{t('createMenuTitle')}</Text>
              <TouchableOpacity
                onPress={handleCreateCatalog}
                disabled={createCatalogMutation.isPending || !catalogName.trim()}
                style={[
                  styles.modalSaveButton,
                  { backgroundColor: colors.primary },
                  (!catalogName.trim() || createCatalogMutation.isPending) && styles.modalSaveButtonDisabled
                ]}
                accessibilityRole="button"
                accessibilityLabel={createCatalogMutation.isPending ? tc('creating') : tc('create')}
              >
                {createCatalogMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" accessibilityLabel={tc('creating')} />
                ) : (
                  <Text style={styles.modalSaveButtonText} maxFontSizeMultiplier={1.3}>{tc('create')}</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Modal Body */}
            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={[styles.modalBodyContent, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              automaticallyAdjustKeyboardInsets
            >
              <View style={styles.inputSection}>
                <Text style={[styles.inputLabel, { color: colors.text }]} maxFontSizeMultiplier={1.5}>{ts('menuNameLabel')}</Text>
                <TextInput
                  style={[styles.textInput, {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.text,
                  }]}
                  value={catalogName}
                  onChangeText={setCatalogName}
                  placeholder={t('menuNamePlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  maxLength={100}
                  autoFocus
                  accessibilityLabel={ts('menuNameLabel')}
                />
              </View>

              <View style={styles.inputSection}>
                <Text style={[styles.inputLabel, { color: colors.text }]} maxFontSizeMultiplier={1.5}>{ts('descriptionLabel')}</Text>
                <TextInput
                  style={[styles.textInput, styles.textArea, {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.text,
                  }]}
                  value={catalogDescription}
                  onChangeText={setCatalogDescription}
                  placeholder={t('descriptionPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  maxLength={500}
                  multiline
                  numberOfLines={2}
                  accessibilityLabel={ts('descriptionLabel')}
                />
              </View>

              <View style={styles.inputSection}>
                <Text style={[styles.inputLabel, { color: colors.text }]} maxFontSizeMultiplier={1.5}>{ts('locationLabel')}</Text>
                <View style={[styles.inputWithIcon, {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                }]}>
                  <Ionicons name="location-outline" size={20} color={colors.textMuted} />
                  <TextInput
                    style={[styles.inputInner, { color: colors.text }]}
                    value={catalogLocation}
                    onChangeText={setCatalogLocation}
                    placeholder={t('locationPlaceholder')}
                    placeholderTextColor={colors.textMuted}
                    maxLength={100}
                    accessibilityLabel={ts('locationLabel')}
                  />
                </View>
              </View>

              {/* Date */}
              <View style={styles.inputSection}>
                <Text style={[styles.inputLabel, { color: colors.text }]} maxFontSizeMultiplier={1.5}>{ts('dateLabel')}</Text>
                <TouchableOpacity
                  style={[styles.dateSelector, {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  }]}
                  onPress={() => setShowDatePicker(true)}
                  accessibilityRole="button"
                  accessibilityLabel={catalogDate ? `${ts('dateLabel')}: ${formatDate(catalogDate)}` : ts('selectDateOptional')}
                  accessibilityHint={ts('opensDatePicker')}
                >
                  <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
                  <Text style={[
                    styles.dateSelectorText,
                    { color: catalogDate ? colors.text : colors.textMuted }
                  ]} maxFontSizeMultiplier={1.5}>
                    {catalogDate ? formatDate(catalogDate) : ts('selectDateOptional')}
                  </Text>
                  {catalogDate && (
                    <TouchableOpacity
                      onPress={handleClearDate}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel={ts('clearDate')}
                    >
                      <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
                {showDatePicker && (
                  Platform.OS === 'ios' ? (
                    <View style={[styles.datePickerContainer, {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    }]}>
                      <View style={[styles.datePickerHeader, { borderBottomColor: colors.border }]}>
                        <TouchableOpacity onPress={() => setShowDatePicker(false)} accessibilityRole="button" accessibilityLabel={tc('cancel')}>
                          <Text style={[styles.datePickerCancel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>{tc('cancel')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setShowDatePicker(false)} accessibilityRole="button" accessibilityLabel={tc('done')}>
                          <Text style={[styles.datePickerDone, { color: colors.primary }]} maxFontSizeMultiplier={1.5}>{tc('done')}</Text>
                        </TouchableOpacity>
                      </View>
                      <DateTimePicker
                        value={catalogDate || new Date()}
                        mode="date"
                        display="spinner"
                        onChange={handleDateChange}
                        textColor={colors.text}
                        themeVariant={isDark ? 'dark' : 'light'}
                      />
                    </View>
                  ) : (
                    <DateTimePicker
                      value={catalogDate || new Date()}
                      mode="date"
                      display="default"
                      onChange={handleDateChange}
                    />
                  )
                )}
              </View>

              {/* Layout Type */}
              <View style={styles.inputSection}>
                <Text style={[styles.inputLabel, { color: colors.text }]} maxFontSizeMultiplier={1.5}>{ts('productLayoutLabel')}</Text>
                <View style={styles.layoutOptions}>
                  {LAYOUT_OPTIONS.map(option => {
                    const label = ts(option.labelKey);
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.layoutOption,
                          { backgroundColor: colors.card, borderColor: colors.border },
                          layoutType === option.value && { borderColor: colors.primary, backgroundColor: colors.primary + '15' }
                        ]}
                        onPress={() => setLayoutType(option.value)}
                        accessibilityRole="button"
                        accessibilityLabel={ts('layoutAccessibilityLabel', { label })}
                        accessibilityState={{ selected: layoutType === option.value }}
                      >
                        <Ionicons
                          name={option.icon}
                          size={24}
                          color={layoutType === option.value ? colors.primary : colors.textSecondary}
                        />
                        <Text style={[
                          styles.layoutOptionText,
                          { color: layoutType === option.value ? colors.primary : colors.textSecondary }
                        ]} maxFontSizeMultiplier={1.3}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.inputSection}>
                <Text style={[styles.inputLabel, { color: colors.text }]} maxFontSizeMultiplier={1.5}>{ts('taxRateLabel')}</Text>
                <View style={[styles.taxInputContainer, {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                }]}>
                  <TextInput
                    style={[styles.taxInput, { color: colors.text }]}
                    value={taxRateString}
                    onChangeText={setTaxRateString}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    accessibilityLabel={ts('taxRateLabel')}
                  />
                  <Text style={[styles.taxSymbol, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>{tc('percentSymbol')}</Text>
                </View>
              </View>

              {/* Divider */}
              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              {/* Show Tip Screen Toggle */}
              <View style={styles.inputSection}>
                <View style={styles.toggleRow}>
                  <View style={styles.toggleInfo}>
                    <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]} maxFontSizeMultiplier={1.5}>{ts('showTipScreen')}</Text>
                    <Text style={[styles.toggleDescription, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                      {ts('showTipScreenDescription')}
                    </Text>
                  </View>
                  <Toggle value={showTipScreen} onValueChange={setShowTipScreen} accessibilityLabel={ts('showTipScreen')} />
                </View>
              </View>

              {/* Tip Percentages (only show if tip screen is enabled) */}
              {showTipScreen && (
                <>
                  <View style={styles.inputSection}>
                    <View style={styles.tipHeader}>
                      <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]} maxFontSizeMultiplier={1.5}>{ts('tipOptions')}</Text>
                      {tipPercentages.length < 6 && (
                        <TouchableOpacity onPress={handleAddTipPercentage} accessibilityRole="button" accessibilityLabel={ts('addTipPercentage')}>
                          <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={styles.tipPercentages}>
                      {tipPercentages.map((percentage, index) => (
                        <View key={index} style={[styles.tipChip, {
                          backgroundColor: colors.card,
                          borderColor: colors.border,
                        }]}>
                          {editingTipIndex === index ? (
                            <View style={styles.tipEditRow}>
                              <TextInput
                                style={[styles.tipEditInput, { color: colors.text }]}
                                value={editingTipValue}
                                onChangeText={setEditingTipValue}
                                keyboardType="number-pad"
                                autoFocus
                                maxLength={3}
                                onSubmitEditing={handleSaveTipEdit}
                                accessibilityLabel={ts('editTipPercentage')}
                              />
                              <TouchableOpacity onPress={handleSaveTipEdit} accessibilityRole="button" accessibilityLabel={ts('saveTipPercentage')}>
                                <Ionicons name="checkmark" size={18} color={colors.success} />
                              </TouchableOpacity>
                              <TouchableOpacity onPress={handleCancelTipEdit} accessibilityRole="button" accessibilityLabel={ts('cancelEditingTip')}>
                                <Ionicons name="close" size={18} color={colors.error} />
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <>
                              <TouchableOpacity
                                onPress={() => handleStartEditTip(index)}
                                style={styles.tipValueButton}
                                accessibilityRole="button"
                                accessibilityLabel={ts('editTipOption', { percentage })}
                              >
                                <Text style={[styles.tipText, { color: colors.text }]} maxFontSizeMultiplier={1.5}>{percentage}%</Text>
                              </TouchableOpacity>
                              {tipPercentages.length > 1 && (
                                <TouchableOpacity
                                  onPress={() => handleRemoveTipPercentage(index)}
                                  style={styles.tipRemove}
                                  accessibilityRole="button"
                                  accessibilityLabel={ts('removeTipOption', { percentage })}
                                >
                                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                                </TouchableOpacity>
                              )}
                            </>
                          )}
                        </View>
                      ))}
                    </View>
                  </View>

                  <View style={styles.inputSection}>
                    <View style={styles.toggleRow}>
                      <View style={styles.toggleInfo}>
                        <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]} maxFontSizeMultiplier={1.5}>{ts('allowCustomTip')}</Text>
                        <Text style={[styles.toggleDescription, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                          {ts('allowCustomTipDescription')}
                        </Text>
                      </View>
                      <Toggle value={allowCustomTip} onValueChange={setAllowCustomTip} accessibilityLabel={ts('allowCustomTip')} />
                    </View>
                  </View>
                </>
              )}

              {/* Prompt for Email Toggle */}
              <View style={styles.inputSection}>
                <View style={styles.toggleRow}>
                  <View style={styles.toggleInfo}>
                    <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]} maxFontSizeMultiplier={1.5}>{ts('promptForEmail')}</Text>
                    <Text style={[styles.toggleDescription, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                      {t('promptForEmailDesc')}
                    </Text>
                  </View>
                  <Toggle value={promptForEmail} onValueChange={setPromptForEmail} accessibilityLabel={ts('promptForEmail')} />
                </View>
              </View>

              <View style={[styles.infoBox, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '20' }]}>
                <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
                <Text style={[styles.infoBoxText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                  {t('infoAfterCreating')}
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function SetupRequired({ type, onQuickCharge }: SetupRequiredProps) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const isManager = user?.role === 'owner' || user?.role === 'admin';

  if (type === 'no-payment-account') {
    return <PaymentSetupRequired colors={colors} isManager={isManager} />;
  }

  return <NoCatalogsWelcome colors={colors} isDark={isDark} isManager={isManager} onQuickCharge={onQuickCharge} />;
}

const createSimpleStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
      backgroundColor: colors.background,
    },
    iconContainer: {
      marginBottom: 20,
    },
    title: {
      fontSize: 20,
      fontFamily: fonts.bold,
      color: colors.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    message: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 32,
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 16,
      paddingHorizontal: 24,
      borderRadius: 12,
    },
    buttonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },
  });

const createWelcomeStyles = (colors: any, isDark: boolean) => {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContainer: {
      flex: 1,
    },
    scrollContent: {
      paddingBottom: 40,
    },
    headerContainer: {
    },
    // Greeting
    greetingSection: {
      paddingTop: 24,
      paddingHorizontal: 24,
      paddingBottom: 28,
    },
    greeting: {
      fontSize: 16,
      fontFamily: fonts.medium,
      marginBottom: 6,
    },
    orgName: {
      fontSize: 30,
      fontFamily: fonts.bold,
      letterSpacing: -0.5,
      marginBottom: 12,
    },
    welcomeSub: {
      fontSize: 16,
      fontFamily: fonts.regular,
      lineHeight: 24,
    },
    // Primary CTA
    ctaSection: {
      paddingHorizontal: 20,
      marginBottom: 28,
    },
    ctaCard: {
      borderRadius: 24,
      padding: 28,
      alignItems: 'center',
    },
    ctaIconWrap: {
      marginBottom: 16,
    },
    ctaTitle: {
      fontSize: 20,
      fontFamily: fonts.bold,
      color: '#fff',
      textAlign: 'center',
      marginBottom: 8,
    },
    ctaDesc: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: 'rgba(255,255,255,0.8)',
      textAlign: 'center',
      lineHeight: 22,
    },
    // Steps preview
    stepsSection: {
      paddingHorizontal: 20,
      marginBottom: 24,
    },
    sectionLabel: {
      fontSize: 12,
      fontFamily: fonts.semiBold,
      letterSpacing: 0.5,
      marginBottom: 10,
      marginLeft: 4,
    },
    stepsCard: {
      borderRadius: 20,
      borderWidth: 1,
      overflow: 'hidden',
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      paddingHorizontal: 16,
      gap: 14,
    },
    stepDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    stepTextWrap: {
      flex: 1,
    },
    stepLabel: {
      fontSize: 15,
      fontFamily: fonts.semiBold,
      marginBottom: 2,
    },
    stepHint: {
      fontSize: 13,
      fontFamily: fonts.regular,
    },
    stepDivider: {
      height: 1,
      marginLeft: 40,
    },
    // Link cards
    linksSection: {
      paddingHorizontal: 20,
      gap: 12,
      marginBottom: 24,
    },
    linkCard: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
      gap: 14,
    },
    linkIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    linkTextWrap: {
      flex: 1,
    },
    linkTitle: {
      fontSize: 15,
      fontFamily: fonts.semiBold,
      marginBottom: 2,
    },
    linkHint: {
      fontSize: 13,
      fontFamily: fonts.regular,
    },
    // Keep old names for modal compatibility
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 12,
      gap: 8,
    },
    primaryButtonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },
    secondaryCard: {
      borderRadius: 20,
      borderWidth: 1,
      padding: 20,
    },
    secondaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      paddingVertical: 12,
      borderRadius: 12,
      gap: 6,
    },
    secondaryButtonText: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
    },
    vendorHint: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 16,
      paddingBottom: 16,
      gap: 8,
      paddingHorizontal: 20,
    },
    vendorHintText: {
      fontSize: 13,
      fontFamily: fonts.regular,
      textAlign: 'center',
      flex: 1,
    },
    // Modal styles
    modalContainer: {
      flex: 1,
    },
    modalOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    modalContent: {
      position: 'absolute',
      top: 60,
      left: 0,
      right: 0,
      bottom: 0,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderBottomWidth: 1,
    },
    modalCloseButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalTitle: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
    },
    modalSaveButton: {
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 20,
    },
    modalSaveButtonDisabled: {
      opacity: 0.5,
    },
    modalSaveButtonText: {
      color: '#fff',
      fontSize: 16,
      fontFamily: fonts.semiBold,
    },
    modalBody: {
      flex: 1,
      padding: 20,
    },
    modalBodyContent: {
      paddingBottom: 40,
    },
    inputSection: {
      marginBottom: 20,
    },
    inputLabel: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
      marginBottom: 8,
    },
    textInput: {
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      fontFamily: fonts.regular,
    },
    textArea: {
      minHeight: 60,
      textAlignVertical: 'top',
    },
    inputWithIcon: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
    },
    inputInner: {
      flex: 1,
      paddingVertical: 14,
      paddingHorizontal: 8,
      fontSize: 16,
      fontFamily: fonts.regular,
    },
    dateSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 14,
      gap: 8,
    },
    dateSelectorText: {
      flex: 1,
      fontSize: 16,
      fontFamily: fonts.regular,
    },
    datePickerContainer: {
      marginTop: 8,
      borderRadius: 12,
      overflow: 'hidden',
      borderWidth: 1,
    },
    datePickerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
    },
    datePickerCancel: {
      fontSize: 16,
      fontFamily: fonts.regular,
    },
    datePickerDone: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
    },
    layoutOptions: {
      flexDirection: 'row',
      gap: 8,
    },
    layoutOption: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 8,
      borderWidth: 1,
      borderRadius: 12,
    },
    layoutOptionText: {
      fontSize: 12,
      fontFamily: fonts.medium,
      marginTop: 4,
    },
    divider: {
      height: 1,
      marginVertical: 8,
    },
    tipHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    tipPercentages: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    tipChip: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 20,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    tipValueButton: {
      marginRight: 4,
    },
    tipText: {
      fontSize: 14,
      fontFamily: fonts.medium,
    },
    tipRemove: {
      marginLeft: 4,
    },
    tipEditRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    tipEditInput: {
      width: 40,
      fontSize: 14,
      fontFamily: fonts.regular,
      textAlign: 'center',
      padding: 0,
    },
    taxInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 16,
    },
    taxInput: {
      flex: 1,
      paddingVertical: 14,
      fontSize: 16,
      fontFamily: fonts.regular,
    },
    taxSymbol: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    toggleInfo: {
      flex: 1,
      marginRight: 16,
    },
    toggleDescription: {
      fontSize: 13,
      fontFamily: fonts.regular,
      marginTop: 2,
    },
    infoBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      gap: 10,
      marginTop: 8,
      marginBottom: 20,
    },
    infoBoxText: {
      flex: 1,
      fontSize: 14,
      fontFamily: fonts.regular,
      lineHeight: 20,
    },
  });
};
