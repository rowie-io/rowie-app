import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../context/ThemeContext';
import { useCatalog } from '../context/CatalogContext';
import { catalogsApi } from '../lib/api';
import { Toggle } from '../components/Toggle';
import { ConfirmModal } from '../components/ConfirmModal';
import { fonts } from '../lib/fonts';
import { glass } from '../lib/colors';
import { shadows } from '../lib/shadows';
import logger from '../lib/logger';

interface CatalogSettings {
  showTipScreen: boolean;
  promptForEmail: boolean;
  tipPercentages: number[];
  allowCustomTip: boolean;
}

export function TapToPaySettingsScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { selectedCatalog, refreshCatalogs } = useCatalog();

  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<CatalogSettings>({
    showTipScreen: selectedCatalog?.showTipScreen ?? true,
    promptForEmail: selectedCatalog?.promptForEmail ?? true,
    tipPercentages: selectedCatalog?.tipPercentages ?? [15, 18, 20, 25],
    allowCustomTip: selectedCatalog?.allowCustomTip ?? true,
  });
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [editingTipIndex, setEditingTipIndex] = useState<number | null>(null);
  const [editingTipValue, setEditingTipValue] = useState('');
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(-20)).current;

  const originalSettings: CatalogSettings = useMemo(() => ({
    showTipScreen: selectedCatalog?.showTipScreen ?? true,
    promptForEmail: selectedCatalog?.promptForEmail ?? true,
    tipPercentages: selectedCatalog?.tipPercentages ?? [15, 18, 20, 25],
    allowCustomTip: selectedCatalog?.allowCustomTip ?? true,
  }), [selectedCatalog]);

  const hasChanges = useMemo(() => {
    return settings.showTipScreen !== originalSettings.showTipScreen ||
           settings.promptForEmail !== originalSettings.promptForEmail ||
           settings.allowCustomTip !== originalSettings.allowCustomTip ||
           JSON.stringify(settings.tipPercentages) !== JSON.stringify(originalSettings.tipPercentages);
  }, [settings, originalSettings]);

  const handleBack = () => {
    if (hasChanges) {
      setShowDiscardModal(true);
      return;
    }
    navigation.goBack();
  };

  const isDiscardingRef = React.useRef(false);

  const handleDiscardConfirm = () => {
    isDiscardingRef.current = true;
    setShowDiscardModal(false);
    navigation.goBack();
  };

  React.useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!hasChanges || isDiscardingRef.current) return;
      e.preventDefault();
      setShowDiscardModal(true);
    });
    return unsubscribe;
  }, [navigation, hasChanges]);

  // Update local state when catalog changes
  React.useEffect(() => {
    if (selectedCatalog) {
      setSettings({
        showTipScreen: selectedCatalog.showTipScreen ?? true,
        promptForEmail: selectedCatalog.promptForEmail ?? true,
        tipPercentages: selectedCatalog.tipPercentages ?? [15, 18, 20, 25],
        allowCustomTip: selectedCatalog.allowCustomTip ?? true,
      });
    }
  }, [selectedCatalog]);

  const showToastAndNavigate = () => {
    setShowSuccessToast(true);
    Animated.parallel([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(toastTranslateY, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Wait a moment then navigate back
      setTimeout(() => {
        isDiscardingRef.current = true; // Prevent discard modal
        navigation.goBack();
      }, 1200);
    });
  };

  const saveSettings = async () => {
    if (!selectedCatalog?.id || !hasChanges) return;

    setIsSaving(true);
    try {
      await catalogsApi.update(selectedCatalog.id, {
        showTipScreen: settings.showTipScreen,
        promptForEmail: settings.promptForEmail,
        tipPercentages: settings.tipPercentages,
        allowCustomTip: settings.allowCustomTip,
      });
      await refreshCatalogs();
      showToastAndNavigate();
    } catch (error) {
      logger.error('Failed to save settings:', error);
      Alert.alert('Error', 'Failed to save settings. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddTipPercentage = () => {
    if (settings.tipPercentages.length >= 6) {
      Alert.alert('Limit Reached', 'You can have up to 6 tip options.');
      return;
    }
    const common = [5, 10, 15, 18, 20, 22, 25, 30];
    const next = common.find(p => !settings.tipPercentages.includes(p)) || 15;
    setSettings({
      ...settings,
      tipPercentages: [...settings.tipPercentages, next].sort((a, b) => a - b),
    });
  };

  const handleRemoveTipPercentage = (index: number) => {
    if (settings.tipPercentages.length <= 1) {
      Alert.alert('Minimum Required', 'You must have at least one tip option.');
      return;
    }
    setSettings({
      ...settings,
      tipPercentages: settings.tipPercentages.filter((_, i) => i !== index),
    });
  };

  const handleStartEditTip = (index: number) => {
    setEditingTipIndex(index);
    setEditingTipValue(settings.tipPercentages[index].toString());
  };

  const handleSaveTipEdit = () => {
    if (editingTipIndex === null) return;
    const value = parseInt(editingTipValue, 10);
    if (!isNaN(value) && value > 0 && value <= 100) {
      const newPercentages = [...settings.tipPercentages];
      newPercentages[editingTipIndex] = value;
      setSettings({
        ...settings,
        tipPercentages: newPercentages.sort((a, b) => a - b),
      });
    }
    setEditingTipIndex(null);
    setEditingTipValue('');
  };

  const glassColors = isDark ? glass.dark : glass.light;
  const styles = createStyles(colors, glassColors);

  if (!selectedCatalog) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>Payment Settings</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.emptyContainer}>
          <Ionicons name="folder-open-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText} maxFontSizeMultiplier={1.3}>No menu selected</Text>
          <Text style={styles.emptySubtext} maxFontSizeMultiplier={1.5}>Please select a menu first</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>Payment Settings</Text>
        <TouchableOpacity
          style={styles.saveButtonContainer}
          onPress={saveSettings}
          disabled={!hasChanges || isSaving}
          accessibilityRole="button"
          accessibilityLabel="Save settings"
          accessibilityState={{ disabled: !hasChanges || isSaving }}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Saving" />
          ) : (
            <Text style={[styles.saveText, !hasChanges && styles.saveTextDisabled]} maxFontSizeMultiplier={1.3}>
              Save
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Catalog Info */}
        <View style={styles.catalogInfo}>
          <Ionicons name="folder-outline" size={20} color={colors.primary} />
          <Text style={styles.catalogName} maxFontSizeMultiplier={1.5}>{selectedCatalog.name}</Text>
        </View>

        {/* Tip Settings Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderIcon}>
              <Ionicons name="cash-outline" size={20} color={colors.primary} />
            </View>
            <Text style={styles.cardTitle} maxFontSizeMultiplier={1.3}>Tips</Text>
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel} maxFontSizeMultiplier={1.5}>Show Tip Screen</Text>
              <Text style={styles.settingDescription} maxFontSizeMultiplier={1.5}>Display tip options during checkout</Text>
            </View>
            <Toggle
              value={settings.showTipScreen}
              onValueChange={(v) => setSettings({ ...settings, showTipScreen: v })}
              accessibilityLabel="Show Tip Screen"
            />
          </View>

          {settings.showTipScreen && (
            <>
              {/* Tip Percentages */}
              <View style={styles.tipPercentagesSection}>
                <Text style={styles.tipPercentagesLabel} maxFontSizeMultiplier={1.5}>Tip Percentages</Text>
                <Text style={styles.tipPercentagesDescription} maxFontSizeMultiplier={1.5}>
                  Tap to edit, long press to remove
                </Text>
                <View style={styles.tipPercentagesRow}>
                  {settings.tipPercentages.map((pct, index) => (
                    <TouchableOpacity
                      key={index}
                      style={[
                        styles.tipChip,
                        editingTipIndex === index && styles.tipChipEditing,
                      ]}
                      onPress={() => handleStartEditTip(index)}
                      onLongPress={() => handleRemoveTipPercentage(index)}
                      accessibilityRole="button"
                      accessibilityLabel={`${pct} percent tip option`}
                      accessibilityHint="Tap to edit, long press to remove"
                    >
                      {editingTipIndex === index ? (
                        <TextInput
                          style={styles.tipChipInput}
                          value={editingTipValue}
                          onChangeText={setEditingTipValue}
                          onBlur={handleSaveTipEdit}
                          onSubmitEditing={handleSaveTipEdit}
                          keyboardType="number-pad"
                          autoFocus
                          selectTextOnFocus
                          maxLength={3}
                          accessibilityLabel="Edit tip percentage"
                        />
                      ) : (
                        <Text style={styles.tipChipText} maxFontSizeMultiplier={1.3}>{pct}%</Text>
                      )}
                    </TouchableOpacity>
                  ))}
                  {settings.tipPercentages.length < 6 && (
                    <TouchableOpacity
                      style={styles.tipChipAdd}
                      onPress={handleAddTipPercentage}
                      accessibilityRole="button"
                      accessibilityLabel="Add tip percentage"
                    >
                      <Ionicons name="add" size={20} color={colors.primary} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* Allow Custom Tip */}
              <View style={[styles.settingRow, styles.settingRowBorder]}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel} maxFontSizeMultiplier={1.5}>Allow Custom Tip</Text>
                  <Text style={styles.settingDescription} maxFontSizeMultiplier={1.5}>Let customers enter their own amount</Text>
                </View>
                <Toggle
                  value={settings.allowCustomTip}
                  onValueChange={(v) => setSettings({ ...settings, allowCustomTip: v })}
                  accessibilityLabel="Allow Custom Tip"
                />
              </View>
            </>
          )}
        </View>

        {/* Receipt Settings Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderIcon}>
              <Ionicons name="receipt-outline" size={20} color={colors.primary} />
            </View>
            <Text style={styles.cardTitle} maxFontSizeMultiplier={1.3}>Receipts</Text>
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel} maxFontSizeMultiplier={1.5}>Prompt for Email</Text>
              <Text style={styles.settingDescription} maxFontSizeMultiplier={1.5}>Ask customer for email to send receipt</Text>
            </View>
            <Toggle
              value={settings.promptForEmail}
              onValueChange={(v) => setSettings({ ...settings, promptForEmail: v })}
              accessibilityLabel="Prompt for Email"
            />
          </View>
        </View>

        {/* Info Note */}
        <View style={styles.infoNote}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
          <Text style={styles.infoNoteText} maxFontSizeMultiplier={1.5}>
            These settings only apply to the "{selectedCatalog.name}" menu. Each menu can have different checkout settings.
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmModal
        visible={showDiscardModal}
        title="Discard changes?"
        message="You have unsaved changes that will be lost."
        confirmText="Discard"
        cancelText="Keep Editing"
        confirmStyle="destructive"
        onConfirm={handleDiscardConfirm}
        onCancel={() => setShowDiscardModal(false)}
      />

      {/* Success Toast */}
      {showSuccessToast && (
        <Animated.View
          style={[
            styles.toastContainer,
            {
              opacity: toastOpacity,
              transform: [{ translateY: toastTranslateY }],
            },
          ]}
        >
          <LinearGradient
            colors={['#1a3a2a', '#0f2920', '#0a1f18']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.toast}
          >
            <View style={styles.toastIcon}>
              <Ionicons name="checkmark" size={18} color="#4ade80" />
            </View>
            <Text style={styles.toastText} maxFontSizeMultiplier={1.5} accessibilityRole="alert">Settings saved</Text>
          </LinearGradient>
        </Animated.View>
      )}
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
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: glassColors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    headerRight: {
      width: 50,
    },
    saveButtonContainer: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: glassColors.border,
    },
    saveText: {
      fontSize: 15,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    saveTextDisabled: {
      color: colors.textMuted,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 32,
    },
    emptyText: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
      marginTop: 16,
    },
    emptySubtext: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      marginTop: 4,
    },
    scroll: {
      flex: 1,
      padding: 16,
    },
    catalogInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 16,
      backgroundColor: colors.primary + '15',
      borderRadius: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.primary + '30',
    },
    catalogName: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    card: {
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 20,
      marginBottom: 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: glassColors.border,
      ...shadows.sm,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: glassColors.borderSubtle,
    },
    cardHeaderIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: colors.primary + '15',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    cardTitle: {
      fontSize: 17,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
    },
    settingInfo: {
      flex: 1,
      marginRight: 16,
    },
    settingLabel: {
      fontSize: 16,
      fontFamily: fonts.medium,
      color: colors.text,
      marginBottom: 2,
    },
    settingDescription: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },
    settingRowBorder: {
      borderTopWidth: 1,
      borderTopColor: glassColors.borderSubtle,
    },
    tipPercentagesSection: {
      padding: 16,
      borderTopWidth: 1,
      borderTopColor: glassColors.borderSubtle,
    },
    tipPercentagesLabel: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.text,
      marginBottom: 4,
    },
    tipPercentagesDescription: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      marginBottom: 12,
    },
    tipPercentagesRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    tipChip: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: glassColors.background,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: glassColors.border,
    },
    tipChipEditing: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    tipChipText: {
      fontSize: 15,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    tipChipInput: {
      fontSize: 15,
      fontFamily: fonts.semiBold,
      color: colors.text,
      minWidth: 30,
      textAlign: 'center',
      padding: 0,
    },
    tipChipAdd: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: colors.primary + '15',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.primary + '30',
      borderStyle: 'dashed',
    },
    infoNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      padding: 16,
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 16,
      gap: 10,
      borderWidth: 1,
      borderColor: glassColors.border,
    },
    infoNoteText: {
      flex: 1,
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      lineHeight: 18,
    },
    toastContainer: {
      position: 'absolute',
      top: 100,
      left: 20,
      right: 20,
      borderRadius: 16,
      overflow: 'hidden',
      ...shadows.lg,
    },
    toast: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderWidth: 1,
      borderColor: 'rgba(74, 222, 128, 0.2)',
      borderRadius: 16,
    },
    toastIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: 'rgba(74, 222, 128, 0.15)',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    toastText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: '#4ade80',
    },
  });
};
