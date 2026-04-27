import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES, type SupportedLanguage } from '../lib/languages';
import { useTranslations } from '../lib/i18n';

interface LanguagePickerModalProps {
  visible: boolean;
  onClose: () => void;
}

export function LanguagePickerModal({ visible, onClose }: LanguagePickerModalProps) {
  const { colors } = useTheme();
  const t = useTranslations('components.languagePicker');
  const tc = useTranslations('common');
  const { language, orgLanguage, setLanguage, resetToOrgDefault, isUserOverride, isLoading } = useLanguage();

  const handleSelect = async (lang: SupportedLanguage) => {
    try {
      if (lang === orgLanguage && isUserOverride) {
        await resetToOrgDefault();
      } else {
        await setLanguage(lang);
      }
      onClose();
    } catch {
      // Error handled in context
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{t('title')}</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel={tc('close')}
          >
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isSelected = lang === language;
            const isOrgDefault = lang === orgLanguage;

            return (
              <TouchableOpacity
                key={lang}
                style={[
                  styles.row,
                  { borderBottomColor: colors.border },
                  isSelected && { backgroundColor: colors.primary + '10' },
                ]}
                onPress={() => handleSelect(lang)}
                disabled={isLoading}
                accessibilityLabel={`${LANGUAGE_NAMES[lang]}${isOrgDefault ? `, ${t('defaultBadge')}` : ''}${isSelected ? `, ${tc('active')}` : ''}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
              >
                <View style={styles.rowLeft}>
                  <Text style={[styles.languageName, { color: colors.text }]} maxFontSizeMultiplier={1.5}>
                    {LANGUAGE_NAMES[lang]}
                  </Text>
                  {isOrgDefault && (
                    <Text style={[styles.defaultBadge, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                      {t('defaultBadge')}
                    </Text>
                  )}
                </View>
                {isSelected && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    textAlign: 'center',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    padding: 4,
  },
  loadingOverlay: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  languageName: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_500Medium',
  },
  defaultBadge: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_400Regular',
  },
});
