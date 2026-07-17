import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useTranslations } from '../lib/i18n';
import { fonts } from '../lib/fonts';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmStyle?: 'default' | 'destructive';
  /** Disables both buttons and shows a spinner on the confirm button */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  visible,
  title,
  message,
  confirmText: confirmTextProp,
  cancelText: cancelTextProp,
  confirmStyle = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { colors } = useTheme();
  const t = useTranslations('components.confirmModal');
  const confirmText = confirmTextProp ?? t('defaultConfirmText');
  const cancelText = cancelTextProp ?? t('defaultCancelText');
  const isDestructive = confirmStyle === 'destructive';
  const confirmContentColor = isDestructive ? '#FFFFFF' : colors.onPrimary;

  const handleCancel = () => {
    if (!loading) onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
      accessibilityViewIsModal={true}
    >
      <View style={styles.overlay}>
        {/* Backdrop keeps tap-to-dismiss but is hidden from VoiceOver/TalkBack
            (sibling layer, not a parent, so the dialog itself stays focusable). */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleCancel}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View
          style={[styles.container, { backgroundColor: colors.card }]}
          accessible={false}
          accessibilityRole="none"
        >
          {isDestructive && (
            <View style={[styles.warningIconContainer, { backgroundColor: colors.errorBg }]}>
              <Ionicons name="warning-outline" size={26} color={colors.error} />
            </View>
          )}
          <Text
            style={[styles.title, { color: colors.text }]}
            maxFontSizeMultiplier={1.3}
            accessibilityRole="header"
          >
            {title}
          </Text>
          <Text style={[styles.message, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
            {message}
          </Text>
          <View style={styles.buttons}>
            <TouchableOpacity
              style={[
                styles.button,
                styles.cancelButton,
                { borderColor: colors.border },
                loading && styles.buttonDisabled,
              ]}
              onPress={handleCancel}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={cancelText}
              accessibilityHint={t('cancelHint')}
              accessibilityState={{ disabled: loading }}
            >
              <Text style={[styles.buttonText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {cancelText}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.button,
                styles.confirmButton,
                {
                  backgroundColor: isDestructive ? colors.error : colors.primary,
                },
                loading && styles.buttonDisabled,
              ]}
              onPress={onConfirm}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={confirmText}
              accessibilityHint={
                isDestructive
                  ? t('confirmHintDestructive')
                  : t('confirmHint')
              }
              accessibilityState={{ disabled: loading, busy: loading }}
            >
              {loading ? (
                <ActivityIndicator size="small" color={confirmContentColor} />
              ) : (
                <Text style={[styles.buttonText, { color: confirmContentColor }]} maxFontSizeMultiplier={1.3}>
                  {confirmText}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    padding: 24,
  },
  warningIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.semiBold,
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    fontFamily: fonts.regular,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  cancelButton: {
    borderWidth: 1,
  },
  confirmButton: {},
  buttonText: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
  },
});
