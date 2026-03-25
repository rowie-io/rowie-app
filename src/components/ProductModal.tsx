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
  Image,
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

const SCREEN_HEIGHT = Dimensions.get('window').height;
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { getCurrencySymbol, isZeroDecimal, fromSmallestUnit, toSmallestUnit } from '../utils/currency';
import { glass } from '../lib/colors';
import type { Product, Category } from '../lib/api';
import { Toggle } from './Toggle';

interface ProductModalProps {
  visible: boolean;
  product: Product | null; // null for create, Product for edit
  categories: Category[];
  catalogId: string;
  onSave: (data: {
    name: string;
    description: string;
    price: number; // in cents
    categoryId: string | null;
    isActive: boolean;
    image?: {
      uri: string;
      fileName: string;
      mimeType: string;
    };
    removeImage?: boolean;
  }) => Promise<void>;
  onClose: () => void;
  onOpenCategoryManager?: () => void;
}

export function ProductModal({
  visible,
  product,
  categories,
  catalogId,
  onSave,
  onClose,
  onOpenCategoryManager,
}: ProductModalProps) {
  const { colors, isDark } = useTheme();
  const { currency } = useAuth();
  const glassColors = isDark ? glass.dark : glass.light;

  const isEditing = !!product;

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceString, setPriceString] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  // Reset form when modal opens/closes or product changes
  useEffect(() => {
    if (visible) {
      if (product) {
        setName(product.name);
        setDescription(product.description || '');
        setPriceString(isZeroDecimal(currency) ? String(product.price) : (product.price / 100).toFixed(2));
        setCategoryId(product.categoryId);
        setIsActive(product.isActive);
        setExistingImageUrl(product.imageUrl);
        setImageUri(null);
        setRemoveImage(false);
      } else {
        setName('');
        setDescription('');
        setPriceString('');
        setCategoryId(null);
        setIsActive(true);
        setExistingImageUrl(null);
        setImageUri(null);
        setRemoveImage(false);
      }
    }
  }, [visible, product]);

  // Compress image to reduce file size
  const compressImage = async (uri: string): Promise<string> => {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 800, height: 800 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      return manipulated.uri;
    } catch (error) {
      return uri; // Return original if compression fails
    }
  };

  const handlePickImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'Please allow access to your photo library to add product images.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1, // Get full quality, we'll compress after
      });

      if (!result.canceled && result.assets[0]) {
        // Compress the image before setting
        const compressedUri = await compressImage(result.assets[0].uri);
        setImageUri(compressedUri);
        setRemoveImage(false);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const handleRemoveImage = () => {
    setImageUri(null);
    if (existingImageUrl) {
      setRemoveImage(true);
    }
  };

  const handleSave = async () => {
    // Validate
    if (!name.trim()) {
      Alert.alert('Error', 'Product name is required');
      return;
    }

    const priceNumber = parseFloat(priceString);
    if (isNaN(priceNumber) || priceNumber < 0) {
      Alert.alert('Error', 'Please enter a valid price');
      return;
    }

    setIsSaving(true);
    try {
      const imageData = imageUri ? {
        uri: imageUri,
        fileName: `product_${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
      } : undefined;

      await onSave({
        name: name.trim(),
        description: description.trim(),
        price: toSmallestUnit(priceNumber, currency), // Convert to smallest unit
        categoryId,
        isActive,
        image: imageData,
        removeImage: removeImage && !imageUri,
      });
      onClose();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save product');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedCategory = categories.find(c => c.id === categoryId);
  const activeCategories = categories.filter(c => c.isActive);
  const displayImage = imageUri || (!removeImage ? existingImageUrl : null);

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
            <Text style={styles.title} maxFontSizeMultiplier={1.3}>
              {isEditing ? 'Edit Product' : 'Add Product'}
            </Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={isSaving}
              style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
              accessibilityRole="button"
              accessibilityLabel={isSaving ? 'Saving product' : 'Save product'}
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
            {/* Image Picker */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>Product Image</Text>
              <TouchableOpacity
                style={styles.imagePicker}
                onPress={handlePickImage}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={displayImage ? 'Change product image' : 'Add product image'}
                accessibilityHint="Opens the photo library to select an image"
              >
                {displayImage ? (
                  <View style={styles.imageContainer}>
                    <Image
                      source={{ uri: displayImage }}
                      style={styles.image}
                      resizeMode="cover"
                    />
                    <TouchableOpacity
                      style={styles.removeImageButton}
                      onPress={handleRemoveImage}
                      accessibilityRole="button"
                      accessibilityLabel="Remove product image"
                    >
                      <Ionicons name="close-circle" size={28} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <Ionicons name="camera-outline" size={40} color={colors.textMuted} />
                    <Text style={styles.imagePlaceholderText} maxFontSizeMultiplier={1.5}>Tap to add image</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* Name */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>Name *</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Product name"
                placeholderTextColor={colors.textMuted}
                maxLength={100}
                accessibilityLabel="Product name"
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
                numberOfLines={3}
                maxLength={500}
                accessibilityLabel="Product description"
              />
            </View>

            {/* Price */}
            <View style={styles.section}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>Price *</Text>
              <View style={styles.priceInputContainer}>
                <Text style={styles.currencySymbol} maxFontSizeMultiplier={1.3}>{getCurrencySymbol(currency)}</Text>
                <TextInput
                  style={styles.priceInput}
                  value={priceString}
                  onChangeText={setPriceString}
                  placeholder={isZeroDecimal(currency) ? '0' : '0.00'}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Product price in ${currency.toUpperCase()}`}
                />
              </View>
            </View>

            {/* Category */}
            <View style={styles.section}>
              <View style={styles.labelRow}>
                <Text style={styles.label} maxFontSizeMultiplier={1.5}>Category</Text>
                {onOpenCategoryManager && (
                  <TouchableOpacity onPress={onOpenCategoryManager} accessibilityRole="button" accessibilityLabel="Manage categories">
                    <Text style={styles.manageLink} maxFontSizeMultiplier={1.5}>Manage</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.categorySelectorRow}>
                <TouchableOpacity
                  style={styles.categorySelector}
                  onPress={() => setShowCategoryPicker(!showCategoryPicker)}
                  accessibilityRole="button"
                  accessibilityLabel={`Category: ${selectedCategory?.name || 'No category'}`}
                  accessibilityHint="Opens category picker"
                >
                  <Text style={[
                    styles.categorySelectorText,
                    !selectedCategory && styles.categorySelectorPlaceholder
                  ]} maxFontSizeMultiplier={1.5}>
                    {selectedCategory?.name || 'No category'}
                  </Text>
                  <Ionicons
                    name={showCategoryPicker ? "chevron-up" : "chevron-down"}
                    size={20}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
                {onOpenCategoryManager && (
                  <TouchableOpacity
                    style={styles.addCategoryButton}
                    onPress={onOpenCategoryManager}
                    accessibilityRole="button"
                    accessibilityLabel="Add new category"
                  >
                    <Ionicons name="add" size={22} color={colors.primary} />
                  </TouchableOpacity>
                )}
              </View>

              {showCategoryPicker && (
                <View style={styles.categoryList}>
                  <TouchableOpacity
                    style={[
                      styles.categoryOption,
                      categoryId === null && styles.categoryOptionSelected
                    ]}
                    onPress={() => {
                      setCategoryId(null);
                      setShowCategoryPicker(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="No category"
                    accessibilityState={{ selected: categoryId === null }}
                  >
                    <Text style={[
                      styles.categoryOptionText,
                      categoryId === null && styles.categoryOptionTextSelected
                    ]} maxFontSizeMultiplier={1.5}>
                      No category
                    </Text>
                    {categoryId === null && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                  {activeCategories.map(category => (
                    <TouchableOpacity
                      key={category.id}
                      style={[
                        styles.categoryOption,
                        categoryId === category.id && styles.categoryOptionSelected
                      ]}
                      onPress={() => {
                        setCategoryId(category.id);
                        setShowCategoryPicker(false);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={category.name}
                      accessibilityState={{ selected: categoryId === category.id }}
                    >
                      <Text style={[
                        styles.categoryOptionText,
                        categoryId === category.id && styles.categoryOptionTextSelected
                      ]} maxFontSizeMultiplier={1.5}>
                        {category.name}
                      </Text>
                      {categoryId === category.id && (
                        <Ionicons name="checkmark" size={20} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Availability Toggle */}
            <View style={styles.section}>
              <View style={styles.toggleRow}>
                <View>
                  <Text style={styles.label} maxFontSizeMultiplier={1.5}>Available</Text>
                  <Text style={styles.toggleDescription} maxFontSizeMultiplier={1.5}>
                    Show this product on the menu
                  </Text>
                </View>
                <Toggle
                  value={isActive}
                  onValueChange={setIsActive}
                  accessibilityLabel="Product available"
                />
              </View>
            </View>
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
      marginBottom: 24,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 8,
    },
    labelRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    manageLink: {
      fontSize: 14,
      color: colors.primary,
      fontWeight: '500',
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
      minHeight: 80,
      textAlignVertical: 'top',
    },
    priceInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      borderRadius: 12,
      paddingHorizontal: 16,
    },
    currencySymbol: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.textSecondary,
      marginRight: 4,
    },
    priceInput: {
      flex: 1,
      paddingVertical: 14,
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
    },
    imagePicker: {
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      borderStyle: 'dashed',
    },
    imageContainer: {
      position: 'relative',
    },
    image: {
      width: '100%',
      aspectRatio: 1,
    },
    removeImageButton: {
      position: 'absolute',
      top: 8,
      right: 8,
      backgroundColor: colors.card,
      borderRadius: 14,
    },
    imagePlaceholder: {
      aspectRatio: 16 / 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    imagePlaceholderText: {
      marginTop: 8,
      fontSize: 14,
      color: colors.textMuted,
    },
    categorySelectorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    categorySelector: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    addCategoryButton: {
      width: 48,
      height: 48,
      borderRadius: 12,
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    categorySelectorText: {
      fontSize: 16,
      color: colors.text,
    },
    categorySelectorPlaceholder: {
      color: colors.textMuted,
    },
    categoryList: {
      marginTop: 8,
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      borderRadius: 12,
      overflow: 'hidden',
    },
    categoryOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: glassColors.borderSubtle,
    },
    categoryOptionSelected: {
      backgroundColor: colors.primary + '15',
    },
    categoryOptionText: {
      fontSize: 16,
      color: colors.text,
    },
    categoryOptionTextSelected: {
      color: colors.primary,
      fontWeight: '500',
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    toggleDescription: {
      fontSize: 13,
      color: colors.textMuted,
      marginTop: 2,
    },
  });
