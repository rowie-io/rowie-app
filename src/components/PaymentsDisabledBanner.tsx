import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { openVendorDashboard } from '../lib/auth-handoff';
import { useTranslations } from '../lib/i18n';

interface PaymentsDisabledBannerProps {
  compact?: boolean;
}

export function PaymentsDisabledBanner({ compact = false }: PaymentsDisabledBannerProps) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const t = useTranslations('components.paymentsDisabledBanner');
  const tc = useTranslations('common');
  const styles = createStyles(colors, compact);
  const isManager = user?.role === 'owner' || user?.role === 'admin';

  if (compact) {
    return (
      <View style={styles.compactContainer} accessibilityRole="alert">
        <Ionicons name="alert-circle" size={18} color={colors.warning} />
        <Text style={styles.compactText} maxFontSizeMultiplier={1.5}>{t('compactText')}</Text>
        {isManager && (
          <TouchableOpacity
            onPress={() => openVendorDashboard('/banking')}
            style={styles.compactButton}
            accessibilityRole="button"
            accessibilityLabel={tc('setUp')}
            accessibilityHint={t('compactText')}
          >
            <Text style={styles.compactButtonText} maxFontSizeMultiplier={1.3}>{tc('setUp')}</Text>
            <Ionicons name="open-outline" size={14} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container} accessibilityRole="alert">
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="alert-circle" size={24} color={colors.warning} />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.title} maxFontSizeMultiplier={1.5}>{t('title')}</Text>
          <Text style={styles.message} maxFontSizeMultiplier={1.5}>
            {isManager
              ? t('messageManager')
              : t('messageStaff')}
          </Text>
        </View>
      </View>
      {isManager && (
        <TouchableOpacity
          style={styles.button}
          onPress={() => openVendorDashboard('/banking')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('buttonText')}
          accessibilityHint={t('messageManager')}
        >
          <Text style={styles.buttonText} maxFontSizeMultiplier={1.3}>{t('buttonText')}</Text>
          <Ionicons name="open-outline" size={16} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const createStyles = (colors: any, compact: boolean) =>
  StyleSheet.create({
    // Full banner styles
    container: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.warning,
      padding: 16,
      marginHorizontal: 16,
      marginVertical: 12,
    },
    content: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 16,
    },
    iconContainer: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.warningBg,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    textContainer: {
      flex: 1,
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 4,
    },
    message: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 10,
    },
    buttonText: {
      fontSize: 15,
      fontWeight: '600',
      color: '#fff',
    },
    // Compact banner styles
    compactContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.warningBg,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 8,
      marginHorizontal: 16,
      marginVertical: 8,
      gap: 8,
    },
    compactText: {
      flex: 1,
      fontSize: 14,
      fontWeight: '500',
      color: colors.text,
    },
    compactButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    compactButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
    },
  });
