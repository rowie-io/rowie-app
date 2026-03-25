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
import { glass } from '../lib/colors';
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

const LAYOUT_OPTIONS: { value: CatalogLayoutType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'grid', label: 'Grid', icon: 'grid-outline' },
  { value: 'list', label: 'List', icon: 'list-outline' },
  { value: 'large-grid', label: 'Large', icon: 'square-outline' },
  { value: 'compact', label: 'Compact', icon: 'menu-outline' },
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
  const glassColors = isDark ? glass.dark : glass.light;

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
  const [layoutType, setLayoutType] = useState<CatalogLayoutType>('grid');
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
      Alert.alert('Error', 'Menu name is required');
      return;
    }

    const taxRate = parseFloat(taxRateString) || 0;
    if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
      Alert.alert('Error', 'Please enter a valid tax rate (0-100%)');
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
      Alert.alert('Error', error.message || 'Failed to save menu');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDuplicate = () => {
    if (!catalog || !onDuplicate) return;

    Alert.alert(
      'Duplicate Menu',
      `Create a copy of "${catalog.name}" with all its products and settings?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Duplicate',
          onPress: async () => {
            setIsDuplicating(true);
            try {
              await onDuplicate(catalog.id);
              onClose();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to duplicate menu');
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
      'Delete Menu',
      `Are you sure you want to delete "${catalog.name}"? This will remove all products from this menu. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await onDelete(catalog.id);
              onClose();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete menu');
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
      Alert.alert('Limit Reached', 'Maximum 6 tip percentages allowed');
      return;
    }
    // Add a new percentage that's higher than the current max
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

  const styles = createStyles(colors, glassColors, isDark);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.content}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.title} maxFontSizeMultiplier={1.3}>Menu Settings</Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={isSaving}
              style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
              accessibilityRole="button"
              accessibilityLabel={isSaving ? 'Saving menu settings' : 'Save menu settings'}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" accessibilityLabel="Saving" />
              ) : (
                <Text style={styles.saveButtonText} maxFontSizeMultiplier={1.3}>Save</Text>
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
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>Menu Name *</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g., Summer Menu"
                placeholderTextColor={colors.textMuted}
                maxLength={100}
                accessibilityLabel="Menu name"
              />
            </View>

            {/* Description */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={description}
                onChangeText={setDescription}
                placeholder="Optional description"
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={2}
                maxLength={500}
                accessibilityLabel="Menu description"
              />
            </View>

            {/* Location */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>Location</Text>
              <View style={styles.inputWithIcon}>
                <Ionicons name="location-outline" size={20} color={colors.textMuted} />
                <TextInput
                  style={styles.inputInner}
                  value={location}
                  onChangeText={setLocation}
                  placeholder="e.g., Main Stage"
                  placeholderTextColor={colors.textMuted}
                  maxLength={100}
                  accessibilityLabel="Menu location"
                />
              </View>
            </View>

            {/* Date */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>Date</Text>
              <TouchableOpacity
                style={styles.dateSelector}
                onPress={() => setShowDatePicker(true)}
                accessibilityRole="button"
                accessibilityLabel={date ? `Date: ${formatDate(date)}` : 'Select a date'}
                accessibilityHint="Opens date picker"
              >
                <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
                <Text style={[
                  styles.dateSelectorText,
                  !date && styles.dateSelectorPlaceholder
                ]} maxFontSizeMultiplier={1.5}>
                  {date ? formatDate(date) : 'Select a date (optional)'}
                </Text>
                {date && (
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
                  <View style={styles.datePickerContainer}>
                    <View style={styles.datePickerHeader}>
                      <TouchableOpacity onPress={() => setShowDatePicker(false)} accessibilityRole="button" accessibilityLabel="Cancel date selection">
                        <Text style={styles.datePickerCancel} maxFontSizeMultiplier={1.5}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setShowDatePicker(false)} accessibilityRole="button" accessibilityLabel="Confirm date selection">
                        <Text style={styles.datePickerDone} maxFontSizeMultiplier={1.5}>Done</Text>
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
                  <Text style={styles.label} maxFontSizeMultiplier={1.5}>Active</Text>
                  <Text style={styles.toggleDescription} maxFontSizeMultiplier={1.5}>
                    Show this menu in the app
                  </Text>
                </View>
                <Toggle value={isActive} onValueChange={setIsActive} accessibilityLabel="Menu active" />
              </View>
            </View>

            {/* Layout Type */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>Product Layout</Text>
              <View style={styles.layoutOptions}>
                {LAYOUT_OPTIONS.map(option => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.layoutOption,
                      layoutType === option.value && styles.layoutOptionSelected
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
                      layoutType === option.value && styles.layoutOptionTextSelected
                    ]} maxFontSizeMultiplier={1.3}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Tax Rate */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>Tax Rate</Text>
              <View style={styles.taxInputContainer}>
                <TextInput
                  style={styles.taxInput}
                  value={taxRateString}
                  onChangeText={setTaxRateString}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Tax rate percentage"
                />
                <Text style={styles.taxSymbol} maxFontSizeMultiplier={1.5}>%</Text>
              </View>
            </View>

            {/* Divider */}
            <View style={styles.divider} />

            {/* Tip Screen Toggle */}
            <View style={styles.section}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={styles.label} maxFontSizeMultiplier={1.5}>Show Tip Screen</Text>
                  <Text style={styles.toggleDescription} maxFontSizeMultiplier={1.5}>
                    Show tip options during checkout
                  </Text>
                </View>
                <Toggle value={showTipScreen} onValueChange={setShowTipScreen} accessibilityLabel="Show tip screen" />
              </View>
            </View>

            {/* Tip Percentages (only show if tip screen is enabled) */}
            {showTipScreen && (
              <>
                <View style={styles.section}>
                  <View style={styles.tipHeader}>
                    <Text style={styles.label} maxFontSizeMultiplier={1.5}>Tip Options</Text>
                    {tipPercentages.length < 6 && (
                      <TouchableOpacity onPress={handleAddTipPercentage} accessibilityRole="button" accessibilityLabel="Add tip percentage">
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
                              <Text style={styles.tipText} maxFontSizeMultiplier={1.5}>{percentage}%</Text>
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

                <View style={styles.section}>
                  <View style={styles.toggleRow}>
                    <View style={styles.toggleInfo}>
                      <Text style={styles.label} maxFontSizeMultiplier={1.5}>Allow Custom Tip</Text>
                      <Text style={styles.toggleDescription} maxFontSizeMultiplier={1.5}>
                        Let customers enter a custom tip amount
                      </Text>
                    </View>
                    <Toggle value={allowCustomTip} onValueChange={setAllowCustomTip} accessibilityLabel="Allow custom tip" />
                  </View>
                </View>
              </>
            )}

            {/* Prompt for Email Toggle */}
            <View style={styles.section}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={styles.label} maxFontSizeMultiplier={1.5}>Prompt for Email</Text>
                  <Text style={styles.toggleDescription} maxFontSizeMultiplier={1.5}>
                    Ask for customer email during checkout
                  </Text>
                </View>
                <Toggle value={promptForEmail} onValueChange={setPromptForEmail} accessibilityLabel="Prompt for email" />
              </View>
            </View>

            {/* Divider */}
            <View style={styles.divider} />

            {/* Preorder Settings (Read-only indicator) */}
            <View style={styles.section}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={styles.label} maxFontSizeMultiplier={1.5}>Pre-Orders</Text>
                  <Text style={styles.toggleDescription} maxFontSizeMultiplier={1.5}>
                    {catalog?.preorderEnabled
                      ? 'Pre-orders are enabled for this menu'
                      : 'Allow customers to order ahead via QR code'}
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
                    {catalog?.preorderEnabled ? 'Enabled' : 'Disabled'}
                  </Text>
                </View>
              </View>
              <View style={styles.preorderNote}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                <Text style={styles.preorderNoteText} maxFontSizeMultiplier={1.5}>
                  Configure pre-order settings, QR codes, and payment options in the Vendor Dashboard
                </Text>
              </View>
            </View>

            {/* Catalog Actions */}
            {(onDuplicate || onDelete) && (
              <View style={styles.actionsSection}>
                <Text style={styles.actionsSectionTitle} maxFontSizeMultiplier={1.5}>Menu Actions</Text>

                {onDuplicate && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.duplicateButton]}
                    onPress={handleDuplicate}
                    disabled={isDuplicating}
                    accessibilityRole="button"
                    accessibilityLabel={isDuplicating ? 'Duplicating menu' : 'Duplicate menu'}
                  >
                    {isDuplicating ? (
                      <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Duplicating" />
                    ) : (
                      <>
                        <Ionicons name="copy-outline" size={20} color={colors.primary} />
                        <Text style={[styles.actionButtonText, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>
                          Duplicate Menu
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
                    accessibilityLabel={isDeleting ? 'Deleting menu' : 'Delete menu'}
                  >
                    {isDeleting ? (
                      <ActivityIndicator size="small" color={colors.error} accessibilityLabel="Deleting" />
                    ) : (
                      <>
                        <Ionicons name="trash-outline" size={20} color={colors.error} />
                        <Text style={[styles.actionButtonText, { color: colors.error }]} maxFontSizeMultiplier={1.3}>
                          Delete Menu
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

const createStyles = (colors: any, glassColors: any, isDark: boolean) =>
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
      borderBottomColor: glassColors.border,
    },
    closeButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: glassColors.backgroundElevated,
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
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
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
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
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
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
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
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 12,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: glassColors.border,
    },
    datePickerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: glassColors.border,
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
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
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
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
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
      backgroundColor: glassColors.border,
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
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
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
      borderTopColor: glassColors.border,
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
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
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
      borderTopColor: glassColors.border,
      gap: 8,
    },
    preorderNoteText: {
      flex: 1,
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 18,
    },
  });
