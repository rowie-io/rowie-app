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

interface PayoutsSetupBannerProps {
  compact?: boolean;
}

/**
 * Shows when user can accept payments (chargesEnabled) but hasn't set up payouts yet.
 * This is a non-blocking informational banner - they can still use Tap to Pay.
 */
export function PayoutsSetupBanner({ compact = false }: PayoutsSetupBannerProps) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const styles = createStyles(colors, compact, isDark);
  const isManager = user?.role === 'owner' || user?.role === 'admin';

  if (compact) {
    return (
      <View style={styles.compactContainer} accessibilityRole="alert">
        <Ionicons name="information-circle" size={18} color={colors.info} />
        <Text style={styles.compactText} maxFontSizeMultiplier={1.5}>Link bank to receive payouts</Text>
        {isManager && (
          <TouchableOpacity
            onPress={() => openVendorDashboard('/banking')}
            style={styles.compactButton}
            accessibilityRole="button"
            accessibilityLabel="Set up payouts"
            accessibilityHint="Opens the Vendor Portal to link your bank account for payouts"
          >
            <Text style={styles.compactButtonText} maxFontSizeMultiplier={1.3}>Set up</Text>
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
          <Ionicons name="checkmark-circle" size={24} color={colors.success} />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.title} maxFontSizeMultiplier={1.5}>Payments ready!</Text>
          <Text style={styles.message} maxFontSizeMultiplier={1.5}>
            {isManager
              ? 'You can accept Tap to Pay payments. Link your bank account to receive payouts.'
              : 'You can accept Tap to Pay payments.'}
          </Text>
        </View>
      </View>
      {isManager && (
        <TouchableOpacity
          style={styles.button}
          onPress={() => openVendorDashboard('/banking')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Complete Setup"
          accessibilityHint="Opens the Vendor Portal to link your bank account for receiving payouts"
        >
          <Text style={styles.buttonText} maxFontSizeMultiplier={1.3}>Complete Setup</Text>
          <Ionicons name="open-outline" size={16} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const createStyles = (colors: any, compact: boolean, isDark: boolean) =>
  StyleSheet.create({
    // Full banner styles
    container: {
      backgroundColor: isDark ? '#181819' : colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: isDark ? '#0f2a17' : colors.success,
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
      backgroundColor: isDark ? '#0a1a0f' : (colors.successBg || colors.success + '20'),
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
      backgroundColor: isDark ? '#0d1420' : (colors.infoBg || colors.info + '15'),
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
