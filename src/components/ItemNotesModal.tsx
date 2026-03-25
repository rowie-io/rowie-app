import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { Product } from '../lib/api/products';
import { glass } from '../lib/colors';
import { fonts } from '../lib/fonts';

interface ItemNotesModalProps {
  visible: boolean;
  product: Product | null;
  initialNotes?: string;
  onConfirm: (notes: string) => void;
  onCancel: () => void;
}

// Common quick-add notes for food service
const QUICK_NOTES = [
  'No ice',
  'Extra ice',
  'No straw',
  'Light ice',
  'No onions',
  'Extra sauce',
  'Gluten-free',
  'Dairy-free',
];

export function ItemNotesModal({
  visible,
  product,
  initialNotes = '',
  onConfirm,
  onCancel,
}: ItemNotesModalProps) {
  const { colors, isDark } = useTheme();
  const glassColors = isDark ? glass.dark : glass.light;
  const [notes, setNotes] = useState(initialNotes);

  // Reset notes when modal opens with new product
  useEffect(() => {
    if (visible) {
      setNotes(initialNotes);
    }
  }, [visible, initialNotes]);

  const handleQuickNote = (note: string) => {
    if (notes.trim()) {
      // Append with comma if there's existing text
      setNotes(prev => `${prev}, ${note}`);
    } else {
      setNotes(note);
    }
  };

  const handleConfirm = () => {
    onConfirm(notes.trim());
  };

  if (!product) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      accessibilityViewIsModal={true}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <Pressable style={styles.overlay} onPress={onCancel} accessibilityLabel="Close" accessibilityRole="button">
          <Pressable
            style={[styles.container, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={[styles.title, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  Add Notes
                </Text>
                <Text style={[styles.productName, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                  {product.name}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.closeButton, { backgroundColor: glassColors.backgroundElevated }]}
                onPress={onCancel}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Notes Input */}
            <View style={[styles.inputContainer, { backgroundColor: glassColors.background, borderColor: glassColors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Special instructions (e.g., no onions, extra sauce)"
                placeholderTextColor={colors.textMuted}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
                maxLength={500}
                autoFocus
                accessibilityLabel={`Special instructions for ${product.name}`}
              />
            </View>

            {/* Quick Notes */}
            <Text style={[styles.quickNotesLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
              Quick add:
            </Text>
            <View style={styles.quickNotes}>
              {QUICK_NOTES.map((note) => (
                <TouchableOpacity
                  key={note}
                  style={[styles.quickNoteButton, { backgroundColor: glassColors.backgroundElevated, borderColor: glassColors.border }]}
                  onPress={() => handleQuickNote(note)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${note}`}
                >
                  <Text style={[styles.quickNoteText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    {note}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Buttons */}
            <View style={styles.buttons}>
              <TouchableOpacity
                style={[styles.button, styles.skipButton, { borderColor: colors.border }]}
                onPress={() => onConfirm('')}
                accessibilityRole="button"
                accessibilityLabel="Skip notes"
                accessibilityHint="Adds item to cart without special instructions"
              >
                <Text style={[styles.buttonText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  Skip Notes
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.addButton, { backgroundColor: colors.primary }]}
                onPress={handleConfirm}
                accessibilityRole="button"
                accessibilityLabel="Add to cart"
                accessibilityHint="Adds item with notes to cart"
              >
                <Text style={[styles.buttonText, { color: '#FFFFFF' }]} maxFontSizeMultiplier={1.3}>
                  Add to Cart
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontFamily: fonts.bold,
    marginBottom: 4,
  },
  productName: {
    fontSize: 15,
    fontFamily: fonts.medium,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputContainer: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  input: {
    fontSize: 16,
    fontFamily: fonts.regular,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  quickNotesLabel: {
    fontSize: 14,
    fontFamily: fonts.medium,
    marginBottom: 10,
  },
  quickNotes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  quickNoteButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  quickNoteText: {
    fontSize: 14,
    fontFamily: fonts.medium,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  skipButton: {
    borderWidth: 1,
  },
  addButton: {},
  buttonText: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
  },
});
