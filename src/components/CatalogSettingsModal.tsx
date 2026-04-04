import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Dimensions,
  KeyboardAvoidingView,
} from 'react-native';

const SCREEN_HEIGHT = Dimensions.get('window').height;
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useTranslations } from '../lib/i18n';
import type { Catalog, CatalogLayoutType, UpdateCatalogData } from '../lib/api';
import { Toggle } from './Toggle';

interface CatalogSettingsModalProps {
  visible: boolean;
  catalog: Catalog | null;
  onSave: (data: UpdateCatalogData) => Promise<void>;
  onDuplicate?: (catalogId: string) => Promise<void>;
  onDelete?: (catalogId: string) => Promise<void>;
  onClose: () => void;
}

const LAYOUT_OPTIONS: { value: CatalogLayoutType; labelKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'classic-grid', labelKey: 'layoutClassicGrid', icon: 'grid-outline' },
  { value: 'split-view', labelKey: 'layoutSplitView', icon: 'browsers-outline' },
  { value: 'list', labelKey: 'layoutList', icon: 'list-outline' },
  { value: 'cards', labelKey: 'layoutCards', icon: 'square-outline' },
  { value: 'mosaic', labelKey: 'layoutMosaic', icon: 'apps-outline' },
  { value: 'compact', labelKey: 'layoutCompact', icon: 'menu-outline' },
];

export function CatalogSettingsModal({
  visible,
  catalog,
  onSave,
  onDuplicate,
  onDelete,
  onClose,
}: CatalogSettingsModalProps) {
  const { colors, isDark } = useTheme();
  const t = useTranslations('components.catalogSettings');
  const tc = useTranslations('common');
  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [showTipScreen, setShowTipScreen] = useState(true);
  const [tipPercentages, setTipPercentages] = useState<number[]>([15, 18, 20, 25]);
  const [allowCustomTip, setAllowCustomTip] = useState(true);
  const [promptForEmail, setPromptForEmail] = useState(false);
  const [taxRateString, setTaxRateString] = useState('0');
  const [layoutType, setLayoutType] = useState<CatalogLayoutType>('classic-grid');
  const [isSaving, setIsSaving] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingTipIndex, setEditingTipIndex] = useState<number | null>(null);
  const [editingTipValue, setEditingTipValue] = useState('');

  // Reset form when modal opens or catalog changes
  useEffect(() => {
    if (visible && catalog) {
      setName(catalog.name);
      setDescription(catalog.description || '');
      setLocation(catalog.location || '');
      setDate(catalog.date ? new Date(catalog.date) : null);
      setIsActive(catalog.isActive);
      setShowTipScreen(catalog.showTipScreen);
      setTipPercentages(catalog.tipPercentages || [15, 18, 20, 25]);
      setAllowCustomTip(catalog.allowCustomTip);
      setPromptForEmail(catalog.promptForEmail);
      setTaxRateString(String(catalog.taxRate || 0));
      setLayoutType(catalog.layoutType);
      setShowDatePicker(false);
    }
  }, [visible, catalog]);

  // Format date for display
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
      setDate(selectedDate);
    }
  };

  const handleClearDate = () => {
    setDate(null);
    setShowDatePicker(false);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert(tc('error'), t('errorMenuNameRequired'));
      return;
    }

    const taxRate = parseFloat(taxRateString) || 0;
    if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
      Alert.alert(tc('error'), t('errorInvalidTaxRate'));
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        date: date ? date.toISOString().split('T')[0] : null,
        isActive,
        showTipScreen,
        tipPercentages,
        allowCustomTip,
        promptForEmail,
        taxRate,
        layoutType,
      });
      onClose();
    } catch (error: any) {
      Alert.alert(tc('error'), error.message || t('errorFailedToSave'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDuplicate = () => {
    if (!catalog || !onDuplicate) return;

    Alert.alert(
      t('duplicateMenuTitle'),
      t('duplicateMenuMessage', { name: catalog.name }),
      [
        { text: tc('cancel'), style: 'cancel' },
        {
          text: t('duplicateButton'),
          onPress: async () => {
            setIsDuplicating(true);
            try {
              await onDuplicate(catalog.id);
              onClose();
            } catch (error: any) {
              Alert.alert(tc('error'), error.message || t('errorFailedToDuplicate'));
            } finally {
              setIsDuplicating(false);
            }
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    if (!catalog || !onDelete) return;

    Alert.alert(
      t('deleteMenuTitle'),
      t('deleteMenuMessage', { name: catalog.name }),
      [
        { text: tc('cancel'), style: 'cancel' },
        {
          text: tc('delete'),
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await onDelete(catalog.id);
              onClose();
            } catch (error: any) {
              Alert.alert(tc('error'), error.message || t('errorFailedToDelete'));
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  const handleAddTipPercentage = () => {
    if (tipPercentages.length >= 6) {
      Alert.alert(t('limitReachedTitle'), t('maxTipPercentages'));
      return;
    }
    // Add a new percentage that's higher than the current max
    const maxTip = Math.max(...tipPercentages, 0);
    const newTip = Math.min(maxTip + 5, 100);
    setTipPercentages([...tipPercentages, newTip]);
  };

  const handleRemoveTipPercentage = (index: number) => {
    if (tipPercentages.length <= 1) {
      Alert.alert(tc('error'), t('atLeastOneTip'));
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
      Alert.alert(tc('error'), t('invalidPercentage'));
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

  const styles = createStyles(colors, isDark);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel={tc('close')} accessibilityRole="button" />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.content}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel={tc('close')}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.title} maxFontSizeMultiplier={1.3}>{t('title')}</Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={isSaving}
              style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
              accessibilityRole="button"
              accessibilityLabel={isSaving ? tc('saving') : tc('save')}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" accessibilityLabel={tc('saving')} />
              ) : (
                <Text style={styles.saveButtonText} maxFontSizeMultiplier={1.3}>{tc('save')}</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Name */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('menuNameLabel')}</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder={t('menuNamePlaceholder')}
                placeholderTextColor={colors.textMuted}
                maxLength={100}
                accessibilityLabel={t('menuNameLabel')}
              />
            </View>

            {/* Description */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('descriptionLabel')}</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={description}
                onChangeText={setDescription}
                placeholder={t('descriptionPlaceholder')}
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={2}
                maxLength={500}
                accessibilityLabel={t('descriptionLabel')}
              />
            </View>

            {/* Location */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('locationLabel')}</Text>
              <View style={styles.inputWithIcon}>
                <Ionicons name="location-outline" size={20} color={colors.textMuted} />
                <TextInput
                  style={styles.inputInner}
                  value={location}
                  onChangeText={setLocation}
                  placeholder={t('locationPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  maxLength={100}
                  accessibilityLabel={t('locationLabel')}
                />
              </View>
            </View>

            {/* Date */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('dateLabel')}</Text>
              <TouchableOpacity
                style={styles.dateSelector}
                onPress={() => setShowDatePicker(true)}
                accessibilityRole="button"
                accessibilityLabel={date ? `${t('dateLabel')}: ${formatDate(date)}` : t('selectDateOptional')}
                accessibilityHint={t('opensDatePicker')}
              >
                <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
                <Text style={[
                  styles.dateSelectorText,
                  !date && styles.dateSelectorPlaceholder
                ]} maxFontSizeMultiplier={1.5}>
                  {date ? formatDate(date) : t('selectDateOptional')}
                </Text>
                {date && (
                  <TouchableOpacity
                    onPress={handleClearDate}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('clearDate')}
                  >
                    <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
              {showDatePicker && (
                Platform.OS === 'ios' ? (
                  <View style={styles.datePickerContainer}>
                    <View style={styles.datePickerHeader}>
                      <TouchableOpacity onPress={() => setShowDatePicker(false)} accessibilityRole="button" accessibilityLabel={tc('cancel')}>
                        <Text style={styles.datePickerCancel} maxFontSizeMultiplier={1.5}>{tc('cancel')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setShowDatePicker(false)} accessibilityRole="button" accessibilityLabel={tc('done')}>
                        <Text style={styles.datePickerDone} maxFontSizeMultiplier={1.5}>{tc('done')}</Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
                      value={date || new Date()}
                      mode="date"
                      display="spinner"
                      onChange={handleDateChange}
                      textColor={colors.text}
                      themeVariant={isDark ? 'dark' : 'light'}
                    />
                  </View>
                ) : (
                  <DateTimePicker
                    value={date || new Date()}
                    mode="date"
                    display="default"
                    onChange={handleDateChange}
                  />
                )
              )}
            </View>

            {/* Active Toggle */}
            <View style={styles.section}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('activeLabel')}</Text>
                  <Text style={styles.toggleDescription} maxFontSizeMultiplier={1.5}>
                    {t('activeDescription')}
                  </Text>
                </View>
                <Toggle value={isActive} onValueChange={setIsActive} accessibilityLabel={t('activeLabel')} />
              </View>
            </View>

            {/* Layout Type */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('productLayoutLabel')}</Text>
              <View style={styles.layoutOptions}>
                {LAYOUT_OPTIONS.map(option => {
                  const label = t(option.labelKey);
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.layoutOption,
                        layoutType === option.value && styles.layoutOptionSelected
                      ]}
                      onPress={() => setLayoutType(option.value)}
                      accessibilityRole="button"
                      accessibilityLabel={t('layoutAccessibilityLabel', { label })}
                      accessibilityState={{ selected: layoutType === option.value }}
                    >
                      <Ionicons
                        name={option.icon}
                        size={24}
                        color={layoutType === option.value ? colors.primary : colors.textSecondary}
                      />
                      <Text style={[
                        styles.layoutOptionText,
                        layoutType === option.value && styles.layoutOptionTextSelected
                      ]} maxFontSizeMultiplier={1.3}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Tax Rate */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('taxRateLabel')}</Text>
              <View style={styles.taxInputContainer}>
                <TextInput
                  style={styles.taxInput}
                  value={taxRateString}
                  onChangeText={setTaxRateString}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  accessibilityLabel={t('taxRateLabel')}
                />
                <Text style={styles.taxSymbol} maxFontSizeMultiplier={1.5}>{tc('percentSymbol')}</Text>
              </View>
            </View>

            {/* Divider */}
            <View style={styles.divider} />

            {/* Tip Screen Toggle */}
            <View style={styles.section}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('showTipScreen')}</Text>
                  <Text style={styles.toggleDescription} maxFontSizeMultiplier={1.5}>
                    {t('showTipScreenDescription')}
                  </Text>
                </View>
                <Toggle value={showTipScreen} onValueChange={setShowTipScreen} accessibilityLabel={t('showTipScreen')} />
              </View>
            </View>

            {/* Tip Percentages (only show if tip screen is enabled) */}
            {showTipScreen && (
              <>
                <View style={styles.section}>
                  <View style={styles.tipHeader}>
                    <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('tipOptions')}</Text>
                    {tipPercentages.length < 6 && (
                      <TouchableOpacity onPress={handleAddTipPercentage} accessibilityRole="button" accessibilityLabel={t('addTipPercentage')}>
                        <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={styles.tipPercentages}>
                    {tipPercentages.map((percentage, index) => (
                      <View key={index} style={styles.tipChip}>
                        {editingTipIndex === index ? (
                          <View style={styles.tipEditRow}>
                            <TextInput
                              style={styles.tipEditInput}
                              value={editingTipValue}
                              onChangeText={setEditingTipValue}
                              keyboardType="number-pad"
                              autoFocus
                              maxLength={3}
                              onSubmitEditing={handleSaveTipEdit}
                              accessibilityLabel={t('editTipPercentage')}
                            />
                            <TouchableOpacity onPress={handleSaveTipEdit} accessibilityRole="button" accessibilityLabel={t('saveTipPercentage')}>
                              <Ionicons name="checkmark" size={18} color={colors.success} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={handleCancelTipEdit} accessibilityRole="button" accessibilityLabel={t('cancelEditingTip')}>
                              <Ionicons name="close" size={18} color={colors.error} />
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <>
                            <TouchableOpacity
                              onPress={() => handleStartEditTip(index)}
                              style={styles.tipValueButton}
                              accessibilityRole="button"
                              accessibilityLabel={t('editTipOption', { percentage })}
                            >
                              <Text style={styles.tipText} maxFontSizeMultiplier={1.5}>{percentage}%</Text>
                            </TouchableOpacity>
                            {tipPercentages.length > 1 && (
                              <TouchableOpacity
                                onPress={() => handleRemoveTipPercentage(index)}
                                style={styles.tipRemove}
                                accessibilityRole="button"
                                accessibilityLabel={t('removeTipOption', { percentage })}
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

                <View style={styles.section}>
                  <View style={styles.toggleRow}>
                    <View style={styles.toggleInfo}>
                      <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('allowCustomTip')}</Text>
                      <Text style={styles.toggleDescription} maxFontSizeMultiplier={1.5}>
                        {t('allowCustomTipDescription')}
                      </Text>
                    </View>
                    <Toggle value={allowCustomTip} onValueChange={setAllowCustomTip} accessibilityLabel={t('allowCustomTip')} />
                  </View>
                </View>
              </>
            )}

            {/* Prompt for Email Toggle */}
            <View style={styles.section}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('promptForEmail')}</Text>
                  <Text style={styles.toggleDescription} maxFontSizeMultiplier={1.5}>
                    {t('promptForEmailDescription')}
                  </Text>
                </View>
                <Toggle value={promptForEmail} onValueChange={setPromptForEmail} accessibilityLabel={t('promptForEmail')} />
              </View>
            </View>

            {/* Divider */}
            <View style={styles.divider} />

            {/* Preorder Settings (Read-only indicator) */}
            <View style={styles.section}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('preOrdersLabel')}</Text>
                  <Text style={styles.toggleDescription} maxFontSizeMultiplier={1.5}>
                    {catalog?.preorderEnabled
                      ? t('preOrdersEnabledDesc')
                      : t('preOrdersDisabledDesc')}
                  </Text>
                </View>
                <View style={[
                  styles.preorderBadge,
                  catalog?.preorderEnabled && styles.preorderBadgeEnabled
                ]}>
                  <Text style={[
                    styles.preorderBadgeText,
                    catalog?.preorderEnabled && styles.preorderBadgeTextEnabled
                  ]} maxFontSizeMultiplier={1.5}>
                    {catalog?.preorderEnabled ? tc('enabled') : tc('disabled')}
                  </Text>
                </View>
              </View>
              <View style={styles.preorderNote}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                <Text style={styles.preorderNoteText} maxFontSizeMultiplier={1.5}>
                  {t('preOrdersConfigNote')}
                </Text>
              </View>
            </View>

            {/* Catalog Actions */}
            {(onDuplicate || onDelete) && (
              <View style={styles.actionsSection}>
                <Text style={styles.actionsSectionTitle} maxFontSizeMultiplier={1.5}>{t('menuActionsTitle')}</Text>

                {onDuplicate && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.duplicateButton]}
                    onPress={handleDuplicate}
                    disabled={isDuplicating}
                    accessibilityRole="button"
                    accessibilityLabel={isDuplicating ? tc('duplicating') : t('duplicateMenuButton')}
                  >
                    {isDuplicating ? (
                      <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={tc('duplicating')} />
                    ) : (
                      <>
                        <Ionicons name="copy-outline" size={20} color={colors.primary} />
                        <Text style={[styles.actionButtonText, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>
                          {t('duplicateMenuButton')}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

                {onDelete && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.deleteButton]}
                    onPress={handleDelete}
                    disabled={isDeleting}
                    accessibilityRole="button"
                    accessibilityLabel={isDeleting ? tc('deleting') : t('deleteMenuButton')}
                  >
                    {isDeleting ? (
                      <ActivityIndicator size="small" color={colors.error} accessibilityLabel={tc('deleting')} />
                    ) : (
                      <>
                        <Ionicons name="trash-outline" size={20} color={colors.error} />
                        <Text style={[styles.actionButtonText, { color: colors.error }]} maxFontSizeMultiplier={1.3}>
                          {t('deleteMenuButton')}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const createStyles = (colors: any, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    content: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      height: SCREEN_HEIGHT * 0.85,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    closeButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
    },
    saveButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 20,
    },
    saveButtonDisabled: {
      opacity: 0.6,
    },
    saveButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: 20,
      paddingBottom: 40,
    },
    section: {
      marginBottom: 20,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 8,
    },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      color: colors.text,
    },
    textArea: {
      minHeight: 60,
      textAlignVertical: 'top',
    },
    inputWithIcon: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 12,
    },
    inputInner: {
      flex: 1,
      paddingVertical: 14,
      paddingHorizontal: 8,
      fontSize: 16,
      color: colors.text,
    },
    dateSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 14,
      gap: 8,
    },
    dateSelectorText: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
    },
    dateSelectorPlaceholder: {
      color: colors.textMuted,
    },
    datePickerContainer: {
      marginTop: 8,
      backgroundColor: colors.card,
      borderRadius: 12,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    datePickerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    datePickerCancel: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    datePickerDone: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.primary,
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
      color: colors.textMuted,
      marginTop: 2,
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
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
    },
    layoutOptionSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + '15',
    },
    layoutOptionText: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 4,
    },
    layoutOptionTextSelected: {
      color: colors.primary,
      fontWeight: '500',
    },
    taxInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 16,
    },
    taxInput: {
      flex: 1,
      paddingVertical: 14,
      fontSize: 16,
      color: colors.text,
    },
    taxSymbol: {
      fontSize: 16,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
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
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    tipValueButton: {
      marginRight: 4,
    },
    tipText: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.text,
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
      color: colors.text,
      textAlign: 'center',
      padding: 0,
    },
    actionsSection: {
      marginTop: 24,
      paddingTop: 24,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    actionsSectionTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: 16,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1,
      gap: 8,
      marginBottom: 12,
    },
    duplicateButton: {
      backgroundColor: colors.primary + '10',
      borderColor: colors.primary + '30',
    },
    deleteButton: {
      backgroundColor: colors.error + '10',
      borderColor: colors.error + '30',
    },
    actionButtonText: {
      fontSize: 16,
      fontWeight: '600',
    },
    preorderBadge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    preorderBadgeEnabled: {
      backgroundColor: colors.success + '15',
      borderColor: colors.success + '30',
    },
    preorderBadgeText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    preorderBadgeTextEnabled: {
      color: colors.success,
    },
    preorderNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: 8,
    },
    preorderNoteText: {
      flex: 1,
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 18,
    },
  });
