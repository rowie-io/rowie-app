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
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

const SCREEN_HEIGHT = Dimensions.get('window').height;
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { glass } from '../lib/colors';
import type { Category } from '../lib/api';
import { Toggle } from './Toggle';

interface CategoryManagerModalProps {
  visible: boolean;
  categories: Category[];
  catalogId: string;
  onCreateCategory: (name: string) => Promise<void>;
  onUpdateCategory: (categoryId: string, data: { name?: string; isActive?: boolean }) => Promise<void>;
  onDeleteCategory: (categoryId: string) => Promise<void>;
  onClose: () => void;
}

export function CategoryManagerModal({
  visible,
  categories,
  catalogId,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onClose,
}: CategoryManagerModalProps) {
  const { colors, isDark } = useTheme();
  const glassColors = isDark ? glass.dark : glass.light;

  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  // Sort categories by sortOrder
  const sortedCategories = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);

  // Reset state when modal closes
  useEffect(() => {
    if (!visible) {
      setNewCategoryName('');
      setEditingCategoryId(null);
      setEditingName('');
    }
  }, [visible]);

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;

    setIsCreating(true);
    try {
      await onCreateCategory(name);
      setNewCategoryName('');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create category');
    } finally {
      setIsCreating(false);
    }
  };

  const handleStartEdit = (category: Category) => {
    setEditingCategoryId(category.id);
    setEditingName(category.name);
  };

  const handleCancelEdit = () => {
    setEditingCategoryId(null);
    setEditingName('');
  };

  const handleSaveEdit = async (categoryId: string) => {
    const name = editingName.trim();
    if (!name) return;

    setSavingIds(prev => new Set(prev).add(categoryId));
    try {
      await onUpdateCategory(categoryId, { name });
      setEditingCategoryId(null);
      setEditingName('');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update category');
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(categoryId);
        return next;
      });
    }
  };

  const handleToggleActive = async (category: Category) => {
    setSavingIds(prev => new Set(prev).add(category.id));
    try {
      await onUpdateCategory(category.id, { isActive: !category.isActive });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update category');
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(category.id);
        return next;
      });
    }
  };

  const handleDeleteCategory = async (category: Category) => {
    Alert.alert(
      'Delete Category',
      `Are you sure you want to delete "${category.name}"? Products in this category will become uncategorized.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSavingIds(prev => new Set(prev).add(category.id));
            try {
              await onDeleteCategory(category.id);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete category');
            } finally {
              setSavingIds(prev => {
                const next = new Set(prev);
                next.delete(category.id);
                return next;
              });
            }
          },
        },
      ]
    );
  };

  const styles = createStyles(colors, glassColors, isDark);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />

        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={1.3}>Manage Categories</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Create New Category */}
          <View style={styles.createSection}>
            <View style={styles.createInputRow}>
              <TextInput
                style={styles.createInput}
                value={newCategoryName}
                onChangeText={setNewCategoryName}
                placeholder="New category name"
                placeholderTextColor={colors.textMuted}
                maxLength={50}
                onSubmitEditing={handleCreateCategory}
                returnKeyType="done"
                accessibilityLabel="New category name"
              />
              <TouchableOpacity
                style={[
                  styles.createButton,
                  (!newCategoryName.trim() || isCreating) && styles.createButtonDisabled
                ]}
                onPress={handleCreateCategory}
                disabled={!newCategoryName.trim() || isCreating}
                accessibilityRole="button"
                accessibilityLabel={isCreating ? 'Creating category' : 'Create category'}
              >
                {isCreating ? (
                  <ActivityIndicator size="small" color="#fff" accessibilityLabel="Creating" />
                ) : (
                  <Ionicons name="add" size={24} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Category List */}
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Info hint */}
            {sortedCategories.length > 0 && (
              <View style={styles.infoHint}>
                <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.infoHintText} maxFontSizeMultiplier={1.5}>
                  Products can be assigned to categories when editing them
                </Text>
              </View>
            )}

            {sortedCategories.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="folder-open-outline" size={56} color={colors.textMuted} />
                <Text style={styles.emptyStateText} maxFontSizeMultiplier={1.3}>No categories yet</Text>
                <Text style={styles.emptyStateSubtext} maxFontSizeMultiplier={1.5}>
                  Create your first category above to organize your products
                </Text>
              </View>
            ) : (
              sortedCategories.map(category => {
                const isEditing = editingCategoryId === category.id;
                const isSaving = savingIds.has(category.id);

                return (
                  <View key={category.id} style={styles.categoryItem}>
                    {isEditing ? (
                      <View style={styles.editRow}>
                        <TextInput
                          style={styles.editInput}
                          value={editingName}
                          onChangeText={setEditingName}
                          autoFocus
                          maxLength={50}
                          onSubmitEditing={() => handleSaveEdit(category.id)}
                          accessibilityLabel="Edit category name"
                        />
                        <TouchableOpacity
                          style={styles.editActionButton}
                          onPress={() => handleSaveEdit(category.id)}
                          disabled={isSaving}
                          accessibilityRole="button"
                          accessibilityLabel="Save category name"
                        >
                          {isSaving ? (
                            <ActivityIndicator size="small" color={colors.success} accessibilityLabel="Saving" />
                          ) : (
                            <Ionicons name="checkmark" size={22} color={colors.success} />
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.editActionButton}
                          onPress={handleCancelEdit}
                          accessibilityRole="button"
                          accessibilityLabel="Cancel editing"
                        >
                          <Ionicons name="close" size={22} color={colors.error} />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={styles.categoryInfo}
                          onPress={() => handleStartEdit(category)}
                          accessibilityRole="button"
                          accessibilityLabel={`Edit ${category.name}`}
                          accessibilityHint="Tap to rename this category"
                        >
                          <View style={styles.categoryNameRow}>
                            <Text style={[
                              styles.categoryName,
                              !category.isActive && styles.categoryNameInactive
                            ]} maxFontSizeMultiplier={1.5}>
                              {category.name}
                            </Text>
                            {!category.isActive && (
                              <View style={styles.hiddenBadge}>
                                <Text style={styles.hiddenBadgeText} maxFontSizeMultiplier={1.5}>Hidden</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.productCount} maxFontSizeMultiplier={1.5}>
                            {category.productCount} {category.productCount === 1 ? 'product' : 'products'}
                          </Text>
                        </TouchableOpacity>

                        <View style={styles.categoryActions}>
                          {isSaving ? (
                            <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Saving" />
                          ) : (
                            <>
                              <Toggle
                                value={category.isActive}
                                onValueChange={() => handleToggleActive(category)}
                                accessibilityLabel={`${category.name} visibility`}
                              />
                              <TouchableOpacity
                                style={styles.deleteButton}
                                onPress={() => handleDeleteCategory(category)}
                                accessibilityRole="button"
                                accessibilityLabel={`Delete ${category.name}`}
                              >
                                <Ionicons name="trash-outline" size={20} color={colors.error} />
                              </TouchableOpacity>
                            </>
                          )}
                        </View>
                      </>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
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
      height: SCREEN_HEIGHT * 0.75,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: glassColors.border,
    },
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
    },
    closeButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: glassColors.backgroundElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    createSection: {
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: glassColors.border,
    },
    createInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    createInput: {
      flex: 1,
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.text,
    },
    createButton: {
      width: 48,
      height: 48,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    createButtonDisabled: {
      opacity: 0.5,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 40,
    },
    infoHint: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primary + '10',
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
      gap: 8,
    },
    infoHintText: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    emptyState: {
      alignItems: 'center',
      paddingVertical: 48,
    },
    emptyStateText: {
      marginTop: 16,
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
    },
    emptyStateSubtext: {
      marginTop: 6,
      fontSize: 14,
      color: colors.textMuted,
      textAlign: 'center',
      paddingHorizontal: 20,
    },
    categoryItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
    },
    categoryInfo: {
      flex: 1,
    },
    categoryNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    categoryName: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.text,
    },
    categoryNameInactive: {
      color: colors.textMuted,
    },
    hiddenBadge: {
      backgroundColor: colors.textMuted + '30',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 4,
    },
    hiddenBadgeText: {
      fontSize: 11,
      fontWeight: '500',
      color: colors.textMuted,
    },
    productCount: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    categoryActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    deleteButton: {
      padding: 8,
    },
    editRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    editInput: {
      flex: 1,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 16,
      color: colors.text,
    },
    editActionButton: {
      padding: 8,
    },
  });
