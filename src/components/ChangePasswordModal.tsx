import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../context/ThemeContext';
import { useTranslations } from '../lib/i18n';
import { authService } from '../lib/api/auth';
import { fonts } from '../lib/fonts';
import logger from '../lib/logger';

interface ChangePasswordModalProps {
  visible: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({ visible, onClose }: ChangePasswordModalProps) {
  const { colors, isDark } = useTheme();
  const t = useTranslations('changePassword');
  const tc = useTranslations('common');
  const insets = useSafeAreaInsets();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswords(false);
    setError(null);
    setIsSubmitting(false);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    setError(null);

    // Inline validation per CLAUDE.md (no window.alert/confirm)
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t('errorRequired'));
      return;
    }
    if (newPassword.length < 8) {
      setError(t('errorTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('errorMismatch'));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t('errorSameAsCurrent'));
      return;
    }

    setIsSubmitting(true);
    try {
      await authService.changePassword(currentPassword, newPassword);

      // On success, all sessions are kicked server-side. Show success and close.
      // The session-kick flow will trigger sign-out via SocketContext / API 401.
      Alert.alert(
        t('successTitle'),
        t('successMessage'),
        [{
          text: tc('ok'),
          onPress: () => {
            resetForm();
            onClose();
          },
        }]
      );
    } catch (err: any) {
      logger.error('[ChangePasswordModal] Error changing password:', err);
      setError(err?.error || err?.message || t('errorGeneric'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const styles = createStyles(colors, isDark);
  const canSubmit = !!currentPassword && !!newPassword && !!confirmPassword && !isSubmitting;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.headerButton}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel={tc('cancel')}
          >
            <Text style={styles.cancelText} maxFontSizeMultiplier={1.3}>{tc('cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.title} maxFontSizeMultiplier={1.3}>{t('title')}</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            style={styles.headerButton}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel={isSubmitting ? t('submitting') : t('submitButton')}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={t('submitting')} />
            ) : (
              <Text style={[styles.saveText, !canSubmit && styles.saveTextDisabled]} maxFontSizeMultiplier={1.3}>
                {tc('save')}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.subtitle} maxFontSizeMultiplier={1.5}>
              {t('subtitle')}
            </Text>

            {/* Current Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('currentPasswordLabel')}</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder={t('currentPasswordPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPasswords}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  editable={!isSubmitting}
                  accessibilityLabel={t('currentPasswordAccessibilityLabel')}
                />
              </View>
            </View>

            {/* New Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('newPasswordLabel')}</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder={t('newPasswordPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPasswords}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="newPassword"
                  editable={!isSubmitting}
                  accessibilityLabel={t('newPasswordAccessibilityLabel')}
                  accessibilityHint={t('newPasswordAccessibilityHint')}
                />
              </View>
            </View>

            {/* Confirm New Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>{t('confirmPasswordLabel')}</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder={t('confirmPasswordPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPasswords}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="newPassword"
                  editable={!isSubmitting}
                  accessibilityLabel={t('confirmPasswordAccessibilityLabel')}
                />
              </View>
            </View>

            {/* Show/hide passwords toggle */}
            <TouchableOpacity
              style={styles.toggleVisibility}
              onPress={() => setShowPasswords(!showPasswords)}
              accessibilityRole="button"
              accessibilityLabel={showPasswords ? t('hidePasswords') : t('showPasswords')}
            >
              <Ionicons
                name={showPasswords ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color={colors.textSecondary}
              />
              <Text style={styles.toggleVisibilityText} maxFontSizeMultiplier={1.5}>
                {showPasswords ? t('hidePasswords') : t('showPasswords')}
              </Text>
            </TouchableOpacity>

            {/* Inline error */}
            {error && (
              <View
                style={styles.errorContainer}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <Text style={styles.errorText} maxFontSizeMultiplier={1.5}>{error}</Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const createStyles = (colors: any, isDark: boolean) => {
  const inputBackground = isDark ? '#0C0A09' : '#f5f5f5';

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#1C1917' : colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 56,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    },
    headerButton: {
      minWidth: 60,
      minHeight: 44,
      justifyContent: 'center',
    },
    title: {
      fontSize: 17,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    cancelText: {
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.primary,
    },
    saveText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.primary,
      textAlign: 'right',
    },
    saveTextDisabled: {
      opacity: 0.4,
    },
    content: {
      flex: 1,
    },
    scrollContent: {
      padding: 20,
      paddingBottom: 40,
    },
    subtitle: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: 20,
    },
    inputGroup: {
      marginBottom: 16,
    },
    label: {
      fontSize: 13,
      fontFamily: fonts.semiBold,
      color: colors.textSecondary,
      marginBottom: 8,
      letterSpacing: 0.3,
    },
    inputWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: inputBackground,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      minHeight: 48,
    },
    input: {
      flex: 1,
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.text,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    toggleVisibility: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      marginTop: 4,
      minHeight: 44,
    },
    toggleVisibilityText: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
    },
    errorContainer: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      marginTop: 12,
      padding: 12,
      backgroundColor: colors.error + '15',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.error + '30',
    },
    errorText: {
      flex: 1,
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.error,
      lineHeight: 20,
    },
  });
};
