import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Dimensions,
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
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation } from '@tanstack/react-query';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { catalogsApi, CreateCatalogData, CatalogLayoutType } from '../lib/api';
import { openVendorDashboard } from '../lib/auth-handoff';
import { glass } from '../lib/colors';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { Toggle } from './Toggle';

const LAYOUT_OPTIONS: { value: CatalogLayoutType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'grid', label: 'Grid', icon: 'grid-outline' },
  { value: 'list', label: 'List', icon: 'list-outline' },
  { value: 'large-grid', label: 'Large', icon: 'square-outline' },
  { value: 'compact', label: 'Compact', icon: 'menu-outline' },
];

export type SetupType = 'no-catalogs' | 'no-payment-account';

interface SetupRequiredProps {
  type: SetupType;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Payment account setup - simple version
function PaymentSetupRequired({ colors, isManager }: { colors: any; isManager: boolean }) {
  const styles = createSimpleStyles(colors);

  return (
    <View style={styles.container} accessibilityRole="alert">
      <View style={styles.iconContainer}>
        <Ionicons name="card-outline" size={64} color={colors.textMuted} />
      </View>
      <Text style={styles.title} maxFontSizeMultiplier={1.2}>Payment Setup Required</Text>
      <Text style={styles.message} maxFontSizeMultiplier={1.5}>
        {isManager
          ? 'Set up your payment account in the Vendor Portal to accept payments.'
          : 'Ask your manager to set up the payment account to accept payments.'}
      </Text>
      {isManager && (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={() => openVendorDashboard('/banking')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Set Up Payments"
          accessibilityHint="Opens the Vendor Portal to set up your payment account"
        >
          <Ionicons name="card" size={18} color="#fff" />
          <Text style={styles.buttonText} maxFontSizeMultiplier={1.3}>Set Up Payments</Text>
          <Ionicons name="open-outline" size={16} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

// Star component for Apple-style sparkle effect
function Star({ style, size = 8, color = 'rgba(255,255,255,0.8)' }: { style?: any; size?: number; color?: string }) {
  return (
    <View style={[{ position: 'absolute' }, style]}>
      <View style={{
        width: size,
        height: size,
        backgroundColor: color,
        borderRadius: size / 2,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: size * 1.5,
      }} />
    </View>
  );
}

// Four-point star for larger sparkles
function FourPointStar({ style, size = 16, color = 'rgba(255,255,255,0.9)' }: { style?: any; size?: number; color?: string }) {
  return (
    <View style={[{ position: 'absolute', width: size, height: size }, style]}>
      {/* Vertical line */}
      <View style={{
        position: 'absolute',
        left: size / 2 - 1,
        top: 0,
        width: 2,
        height: size,
        backgroundColor: color,
        borderRadius: 1,
      }} />
      {/* Horizontal line */}
      <View style={{
        position: 'absolute',
        top: size / 2 - 1,
        left: 0,
        width: size,
        height: 2,
        backgroundColor: color,
        borderRadius: 1,
      }} />
      {/* Center glow */}
      <View style={{
        position: 'absolute',
        left: size / 2 - 2,
        top: size / 2 - 2,
        width: 4,
        height: 4,
        backgroundColor: color,
        borderRadius: 2,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: size / 2,
      }} />
    </View>
  );
}

// No catalogs - full welcome experience
function NoCatalogsWelcome({ colors, glassColors, isDark, isManager }: { colors: any; glassColors: typeof glass.dark; isDark: boolean; isManager: boolean }) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { organization } = useAuth();
  const { refreshCatalogs, setSelectedCatalog } = useCatalog();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [catalogName, setCatalogName] = useState('');
  const [catalogDescription, setCatalogDescription] = useState('');
  const [catalogLocation, setCatalogLocation] = useState('');
  const [catalogDate, setCatalogDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [taxRateString, setTaxRateString] = useState('0');
  const [layoutType, setLayoutType] = useState<CatalogLayoutType>('grid');
  const [showTipScreen, setShowTipScreen] = useState(true);
  const [tipPercentages, setTipPercentages] = useState<number[]>([15, 18, 20, 25]);
  const [allowCustomTip, setAllowCustomTip] = useState(true);
  const [promptForEmail, setPromptForEmail] = useState(false);
  const [editingTipIndex, setEditingTipIndex] = useState<number | null>(null);
  const [editingTipValue, setEditingTipValue] = useState('');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const sparkleAnim = useRef(new Animated.Value(0)).current;

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
      setLayoutType('grid');
      setShowTipScreen(true);
      setTipPercentages([15, 18, 20, 25]);
      setAllowCustomTip(true);
      setPromptForEmail(false);
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || 'Failed to create menu');
    },
  });

  const handleCreateCatalog = () => {
    const name = catalogName.trim();
    if (!name) {
      Alert.alert('Error', 'Please enter a menu name');
      return;
    }

    const taxRate = parseFloat(taxRateString) || 0;
    if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
      Alert.alert('Error', 'Please enter a valid tax rate (0-100%)');
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
      Alert.alert('Limit Reached', 'Maximum 6 tip percentages allowed');
      return;
    }
    const maxTip = Math.max(...tipPercentages, 0);
    const newTip = Math.min(maxTip + 5, 100);
    setTipPercentages([...tipPercentages, newTip]);
  };

  const handleRemoveTipPercentage = (index: number) => {
    if (tipPercentages.length <= 1) {
      Alert.alert('Error', 'At least one tip percentage is required');
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
      Alert.alert('Error', 'Please enter a valid percentage (0-100)');
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
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();

    // Subtle sparkle animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(sparkleAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(sparkleAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const styles = createWelcomeStyles(colors, glassColors, isDark);

  const handleQuickCharge = () => {
    navigation.navigate('QuickCharge');
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
      >
        {/* Welcome Header - Dark with Apple-style stars */}
        <Animated.View
        style={[
          styles.headerContainer,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          }
        ]}
      >
        <View style={[styles.headerBackground, { backgroundColor: isDark ? '#1C1917' : colors.background }]}>
          {/* Subtle gradient overlay */}
          <LinearGradient
            colors={isDark
              ? ['transparent', 'rgba(245, 158, 11, 0.08)', 'rgba(245, 158, 11, 0.05)', 'transparent']
              : ['transparent', 'rgba(245, 158, 11, 0.05)', 'rgba(245, 158, 11, 0.03)', 'transparent']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* Star field - Group 1 (fades in/out) */}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: sparkleAnim }]}>
            <FourPointStar style={{ top: 25, left: 25 }} size={14} color={isDark ? 'rgba(255,255,255,0.7)' : 'rgba(245,158,11,0.4)'} />
            <Star style={{ top: 50, left: 80 }} size={4} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(245,158,11,0.3)'} />
            <Star style={{ top: 35, right: 60 }} size={6} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(245,158,11,0.35)'} />
            <FourPointStar style={{ top: 70, right: 30 }} size={12} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(245,158,11,0.3)'} />
            <Star style={{ top: 90, left: 50 }} size={3} color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(245,158,11,0.25)'} />
            <Star style={{ top: 40, left: SCREEN_WIDTH * 0.45 }} size={5} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(245,158,11,0.3)'} />
            <Star style={{ top: 110, right: 90 }} size={4} color={isDark ? 'rgba(255,255,255,0.45)' : 'rgba(245,158,11,0.25)'} />
          </Animated.View>

          {/* Star field - Group 2 (opposite fade) */}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.subtract(1, sparkleAnim) }]}>
            <Star style={{ top: 30, left: 55 }} size={5} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(245,158,11,0.3)'} />
            <FourPointStar style={{ top: 55, right: 45 }} size={16} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(245,158,11,0.35)'} />
            <Star style={{ top: 80, left: 35 }} size={4} color={isDark ? 'rgba(255,255,255,0.45)' : 'rgba(245,158,11,0.25)'} />
            <Star style={{ top: 45, left: SCREEN_WIDTH * 0.55 }} size={6} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(245,158,11,0.3)'} />
            <FourPointStar style={{ top: 20, right: 100 }} size={10} color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(245,158,11,0.25)'} />
            <Star style={{ top: 100, right: 50 }} size={3} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(245,158,11,0.25)'} />
            <Star style={{ top: 65, left: 100 }} size={5} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(245,158,11,0.3)'} />
          </Animated.View>

          {/* Welcome Content */}
          <View style={styles.headerContent}>
            <View style={[styles.headerIconContainer, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(245,158,11,0.1)',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(245,158,11,0.15)'
            }]}>
              <Ionicons name="storefront" size={44} color={isDark ? 'rgba(255,255,255,0.95)' : colors.primary} />
            </View>
            <Text style={[styles.headerTitle, { color: isDark ? '#fff' : colors.text }]} maxFontSizeMultiplier={1.2}>
              {organization?.name ? `Welcome, ${organization.name}!` : 'Welcome to Rowie!'}
            </Text>
            <Text style={[styles.headerSubtitle, { color: isDark ? 'rgba(255,255,255,0.55)' : colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
              Let's get your menu set up so you can start selling
            </Text>
          </View>

          {/* Create Menu Card - Primary Action */}
          <Animated.View
            style={[
              styles.cardContainer,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              }
            ]}
          >
            <TouchableOpacity
              style={[styles.primaryCard, { backgroundColor: glassColors.backgroundElevated, borderColor: glassColors.border }]}
              onPress={handleOpenCreateModal}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Create Your Menu"
              accessibilityHint="Opens a form to create your first menu"
            >
              <View style={styles.cardHeader}>
                <View style={[styles.primaryIconContainer, { backgroundColor: colors.primary + '20' }]}>
                  <Ionicons name="grid" size={28} color={colors.primary} />
                </View>
                <View style={[styles.cardBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.cardBadgeText} maxFontSizeMultiplier={1.3}>GET STARTED</Text>
                </View>
              </View>

              <Text style={[styles.primaryCardTitle, { color: colors.text }]} maxFontSizeMultiplier={1.2}>Create Your Menu</Text>
              <Text style={[styles.primaryCardDescription, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                Create a menu to start adding products. You can add photos, set prices, and organize into categories.
              </Text>

              <View style={styles.featureList}>
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                  <Text style={[styles.featureText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>Add products with photos & prices</Text>
                </View>
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                  <Text style={[styles.featureText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>Organize into categories</Text>
                </View>
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                  <Text style={[styles.featureText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>Configure tips & tax settings</Text>
                </View>
              </View>

              <View style={[styles.primaryCardButton, { backgroundColor: isDark ? '#fff' : '#1C1917' }]}>
                <Ionicons name="add" size={20} color={isDark ? '#1C1917' : '#fff'} />
                <Text style={[styles.primaryCardButtonText, { color: isDark ? '#1C1917' : '#fff' }]} maxFontSizeMultiplier={1.3}>Create Menu</Text>
              </View>
            </TouchableOpacity>
          </Animated.View>

          {/* Quick Charge Option - Secondary */}
          <Animated.View
            style={[
              styles.quickChargeContainer,
              { opacity: fadeAnim }
            ]}
          >
            <View style={[styles.quickChargeCard, { backgroundColor: glassColors.backgroundSubtle, borderColor: glassColors.border }]}>
              <View style={styles.quickChargeContent}>
                <View style={[styles.quickChargeIcon, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name="flash" size={20} color={colors.primary} />
                </View>
                <View style={styles.quickChargeText}>
                  <Text style={[styles.quickChargeTitle, { color: colors.text }]} maxFontSizeMultiplier={1.5}>Need to charge now?</Text>
                  <Text style={[styles.quickChargeSubtitle, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                    Use Quick Charge for custom amounts — no menu needed
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.quickChargeButton, { borderColor: colors.primary }]}
                onPress={handleQuickCharge}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Go to Quick Charge"
              >
                <Text style={[styles.quickChargeButtonText, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>Quick Charge</Text>
                <Ionicons name="arrow-forward" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* Vendor Portal Hint - owners/admins only */}
          {isManager && (
            <Animated.View style={[styles.vendorHint, { opacity: fadeAnim }]}>
              <Ionicons name="desktop-outline" size={16} color={colors.textMuted} />
              <Text style={[styles.vendorHintText, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                Need advanced management? Open the{' '}
                <Text
                  style={{ color: colors.primary, fontFamily: fonts.semiBold }}
                  onPress={() => openVendorDashboard('/products')}
                  maxFontSizeMultiplier={1.5}
                  accessibilityRole="link"
                  accessibilityLabel="Open Vendor Portal"
                  accessibilityHint="Opens the Vendor Portal for advanced management"
                >
                  Vendor Portal
                </Text>
              </Text>
            </Animated.View>
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
          <Pressable style={styles.modalOverlay} onPress={() => setShowCreateModal(false)} accessibilityLabel="Close" accessibilityRole="button" />
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            {/* Modal Header */}
            <View style={[styles.modalHeader, { borderBottomColor: glassColors.border }]}>
              <TouchableOpacity
                onPress={() => setShowCreateModal(false)}
                style={[styles.modalCloseButton, { backgroundColor: glassColors.backgroundElevated }]}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>Create Menu</Text>
              <TouchableOpacity
                onPress={handleCreateCatalog}
                disabled={createCatalogMutation.isPending || !catalogName.trim()}
                style={[
                  styles.modalSaveButton,
                  { backgroundColor: colors.primary },
                  (!catalogName.trim() || createCatalogMutation.isPending) && styles.modalSaveButtonDisabled
                ]}
                accessibilityRole="button"
                accessibilityLabel={createCatalogMutation.isPending ? 'Creating menu' : 'Create menu'}
              >
                {createCatalogMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" accessibilityLabel="Creating" />
                ) : (
                  <Text style={styles.modalSaveButtonText} maxFontSizeMultiplier={1.3}>Create</Text>
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
                <Text style={[styles.inputLabel, { color: colors.text }]} maxFontSizeMultiplier={1.5}>Menu Name *</Text>
                <TextInput
                  style={[styles.textInput, {
                    backgroundColor: glassColors.backgroundElevated,
                    borderColor: glassColors.border,
                    color: colors.text,
                  }]}
                  value={catalogName}
                  onChangeText={setCatalogName}
                  placeholder="e.g., Summer Menu, Food Truck, Bar Menu"
                  placeholderTextColor={colors.textMuted}
                  maxLength={100}
                  autoFocus
                  accessibilityLabel="Menu name"
                />
              </View>

              <View style={styles.inputSection}>
                <Text style={[styles.inputLabel, { color: colors.text }]} maxFontSizeMultiplier={1.5}>Description</Text>
                <TextInput
                  style={[styles.textInput, styles.textArea, {
                    backgroundColor: glassColors.backgroundElevated,
                    borderColor: glassColors.border,
                    color: colors.text,
                  }]}
                  value={catalogDescription}
                  onChangeText={setCatalogDescription}
                  placeholder="Optional description for this menu"
                  placeholderTextColor={colors.textMuted}
                  maxLength={500}
                  multiline
                  numberOfLines={2}
                  accessibilityLabel="Menu description"
                />
              </View>

              <View style={styles.inputSection}>
                <Text style={[styles.inputLabel, { color: colors.text }]} maxFontSizeMultiplier={1.5}>Location</Text>
                <View style={[styles.inputWithIcon, {
                  backgroundColor: glassColors.backgroundElevated,
                  borderColor: glassColors.border,
                }]}>
                  <Ionicons name="location-outline" size={20} color={colors.textMuted} />
                  <TextInput
                    style={[styles.inputInner, { color: colors.text }]}
                    value={catalogLocation}
                    onChangeText={setCatalogLocation}
                    placeholder="e.g., Main Stage, North Tent"
                    placeholderTextColor={colors.textMuted}
                    maxLength={100}
                    accessibilityLabel="Menu location"
                  />
                </View>
              </View>

              {/* Date */}
              <View style={styles.inputSection}>
                <Text style={[styles.inputLabel, { color: colors.text }]} maxFontSizeMultiplier={1.5}>Date</Text>
                <TouchableOpacity
                  style={[styles.dateSelector, {
                    backgroundColor: glassColors.backgroundElevated,
                    borderColor: glassColors.border,
                  }]}
                  onPress={() => setShowDatePicker(true)}
                  accessibilityRole="button"
                  accessibilityLabel={catalogDate ? `Date: ${formatDate(catalogDate)}` : 'Select a date'}
                  accessibilityHint="Opens date picker"
                >
                  <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
                  <Text style={[
                    styles.dateSelectorText,
                    { color: catalogDate ? colors.text : colors.textMuted }
                  ]} maxFontSizeMultiplier={1.5}>
                    {catalogDate ? formatDate(catalogDate) : 'Select a date (optional)'}
                  </Text>
                  {catalogDate && (
                    <TouchableOpacity
                      onPress={handleClearDate}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel="Clear date"
                    >
                      <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
                {showDatePicker && (
                  Platform.OS === 'ios' ? (
                    <View style={[styles.datePickerContainer, {
                      backgroundColor: glassColors.backgroundElevated,
                      borderColor: glassColors.border,
                    }]}>
                      <View style={[styles.datePickerHeader, { borderBottomColor: glassColors.border }]}>
                        <TouchableOpacity onPress={() => setShowDatePicker(false)} accessibilityRole="button" accessibilityLabel="Cancel date selection">
                          <Text style={[styles.datePickerCancel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setShowDatePicker(false)} accessibilityRole="button" accessibilityLabel="Confirm date selection">
                          <Text style={[styles.datePickerDone, { color: colors.primary }]} maxFontSizeMultiplier={1.5}>Done</Text>
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
                <Text style={[styles.inputLabel, { color: colors.text }]} maxFontSizeMultiplier={1.5}>Product Layout</Text>
                <View style={styles.layoutOptions}>
                  {LAYOUT_OPTIONS.map(option => (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.layoutOption,
                        { backgroundColor: glassColors.backgroundElevated, borderColor: glassColors.border },
                        layoutType === option.value && { borderColor: colors.primary, backgroundColor: colors.primary + '15' }
                      ]}
                      onPress={() => setLayoutType(option.value)}
                      accessibilityRole="button"
                      accessibilityLabel={`${option.label} layout`}
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
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputSection}>
                <Text style={[styles.inputLabel, { color: colors.text }]} maxFontSizeMultiplier={1.5}>Tax Rate</Text>
                <View style={[styles.taxInputContainer, {
                  backgroundColor: glassColors.backgroundElevated,
                  borderColor: glassColors.border,
                }]}>
                  <TextInput
                    style={[styles.taxInput, { color: colors.text }]}
                    value={taxRateString}
                    onChangeText={setTaxRateString}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Tax rate percentage"
                  />
                  <Text style={[styles.taxSymbol, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>%</Text>
                </View>
              </View>

              {/* Divider */}
              <View style={[styles.divider, { backgroundColor: glassColors.border }]} />

              {/* Show Tip Screen Toggle */}
              <View style={styles.inputSection}>
                <View style={styles.toggleRow}>
                  <View style={styles.toggleInfo}>
                    <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]} maxFontSizeMultiplier={1.5}>Show Tip Screen</Text>
                    <Text style={[styles.toggleDescription, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                      Show tip options during checkout
                    </Text>
                  </View>
                  <Toggle value={showTipScreen} onValueChange={setShowTipScreen} accessibilityLabel="Show tip screen" />
                </View>
              </View>

              {/* Tip Percentages (only show if tip screen is enabled) */}
              {showTipScreen && (
                <>
                  <View style={styles.inputSection}>
                    <View style={styles.tipHeader}>
                      <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]} maxFontSizeMultiplier={1.5}>Tip Options</Text>
                      {tipPercentages.length < 6 && (
                        <TouchableOpacity onPress={handleAddTipPercentage} accessibilityRole="button" accessibilityLabel="Add tip percentage">
                          <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={styles.tipPercentages}>
                      {tipPercentages.map((percentage, index) => (
                        <View key={index} style={[styles.tipChip, {
                          backgroundColor: glassColors.backgroundElevated,
                          borderColor: glassColors.border,
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
                                accessibilityLabel="Edit tip percentage"
                              />
                              <TouchableOpacity onPress={handleSaveTipEdit} accessibilityRole="button" accessibilityLabel="Save tip percentage">
                                <Ionicons name="checkmark" size={18} color={colors.success} />
                              </TouchableOpacity>
                              <TouchableOpacity onPress={handleCancelTipEdit} accessibilityRole="button" accessibilityLabel="Cancel editing tip">
                                <Ionicons name="close" size={18} color={colors.error} />
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <>
                              <TouchableOpacity
                                onPress={() => handleStartEditTip(index)}
                                style={styles.tipValueButton}
                                accessibilityRole="button"
                                accessibilityLabel={`Edit ${percentage}% tip option`}
                              >
                                <Text style={[styles.tipText, { color: colors.text }]} maxFontSizeMultiplier={1.5}>{percentage}%</Text>
                              </TouchableOpacity>
                              {tipPercentages.length > 1 && (
                                <TouchableOpacity
                                  onPress={() => handleRemoveTipPercentage(index)}
                                  style={styles.tipRemove}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Remove ${percentage}% tip option`}
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
                        <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]} maxFontSizeMultiplier={1.5}>Allow Custom Tip</Text>
                        <Text style={[styles.toggleDescription, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                          Let customers enter a custom tip amount
                        </Text>
                      </View>
                      <Toggle value={allowCustomTip} onValueChange={setAllowCustomTip} accessibilityLabel="Allow custom tip" />
                    </View>
                  </View>
                </>
              )}

              {/* Prompt for Email Toggle */}
              <View style={styles.inputSection}>
                <View style={styles.toggleRow}>
                  <View style={styles.toggleInfo}>
                    <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]} maxFontSizeMultiplier={1.5}>Prompt for Email</Text>
                    <Text style={[styles.toggleDescription, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                      Ask for customer email for receipts
                    </Text>
                  </View>
                  <Toggle value={promptForEmail} onValueChange={setPromptForEmail} accessibilityLabel="Prompt for email" />
                </View>
              </View>

              <View style={[styles.infoBox, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '20' }]}>
                <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
                <Text style={[styles.infoBoxText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                  After creating your menu, tap the edit button to add products and categories.
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function SetupRequired({ type }: SetupRequiredProps) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const glassColors = isDark ? glass.dark : glass.light;
  const isManager = user?.role === 'owner' || user?.role === 'admin';

  if (type === 'no-payment-account') {
    return <PaymentSetupRequired colors={colors} isManager={isManager} />;
  }

  return <NoCatalogsWelcome colors={colors} glassColors={glassColors} isDark={isDark} isManager={isManager} />;
}

const createSimpleStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 40,
      backgroundColor: colors.background,
    },
    iconContainer: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
    },
    title: {
      fontSize: 24,
      fontFamily: fonts.bold,
      color: colors.text,
      textAlign: 'center',
      marginBottom: 12,
    },
    message: {
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 24,
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

const createWelcomeStyles = (colors: any, glassColors: typeof glass.dark, isDark: boolean) => {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#1C1917' : colors.background,
    },
    scrollContainer: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      paddingBottom: 50,
    },
    headerContainer: {
      marginBottom: 0,
    },
    headerBackground: {
      position: 'relative',
      overflow: 'hidden',
      flexGrow: 1,
      paddingBottom: 40,
    },
    headerContent: {
      paddingTop: 60,
      paddingBottom: 48,
      paddingHorizontal: 24,
      alignItems: 'center',
      zIndex: 10,
    },
    headerIconContainer: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
      borderWidth: 1,
    },
    headerTitle: {
      fontSize: 28,
      fontFamily: fonts.bold,
      textAlign: 'center',
      marginBottom: 8,
      letterSpacing: -0.5,
    },
    headerSubtitle: {
      fontSize: 16,
      fontFamily: fonts.regular,
      textAlign: 'center',
    },
    cardContainer: {
      paddingHorizontal: 16,
      marginBottom: 16,
    },
    primaryCard: {
      borderRadius: 20,
      borderWidth: 1,
      padding: 24,
      ...shadows.md,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    primaryIconContainer: {
      width: 56,
      height: 56,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardBadge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
    },
    cardBadgeText: {
      fontSize: 11,
      fontFamily: fonts.bold,
      color: '#fff',
      letterSpacing: 0.5,
    },
    primaryCardTitle: {
      fontSize: 24,
      fontFamily: fonts.bold,
      marginBottom: 8,
      letterSpacing: -0.3,
    },
    primaryCardDescription: {
      fontSize: 15,
      fontFamily: fonts.regular,
      lineHeight: 22,
      marginBottom: 20,
    },
    featureList: {
      marginBottom: 24,
    },
    featureItem: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    featureText: {
      fontSize: 15,
      fontFamily: fonts.regular,
      marginLeft: 12,
    },
    primaryCardButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      paddingHorizontal: 24,
      borderRadius: 12,
      gap: 10,
    },
    primaryCardButtonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
    },
    quickChargeContainer: {
      paddingHorizontal: 16,
      marginTop: 8,
      marginBottom: 16,
    },
    quickChargeCard: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
    },
    quickChargeContent: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
    },
    quickChargeIcon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    quickChargeText: {
      flex: 1,
    },
    quickChargeTitle: {
      fontSize: 15,
      fontFamily: fonts.semiBold,
      marginBottom: 2,
    },
    quickChargeSubtitle: {
      fontSize: 13,
      fontFamily: fonts.regular,
    },
    quickChargeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      paddingVertical: 12,
      borderRadius: 10,
      gap: 6,
    },
    quickChargeButtonText: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
    },
    vendorHint: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 24,
      paddingBottom: 16,
      gap: 8,
      paddingHorizontal: 24,
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
