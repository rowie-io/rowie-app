import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../lib/fonts';
import { spacing, layout } from '../../lib/spacing';
import { useTranslations } from '../../lib/i18n';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  large?: boolean;
  style?: ViewStyle;
}

export const ScreenHeader = memo(function ScreenHeader({
  title,
  subtitle,
  onBack,
  rightAction,
  large = false,
  style,
}: ScreenHeaderProps) {
  const { colors } = useTheme();
  const t = useTranslations('components.screenHeader');
  const insets = useSafeAreaInsets();

  if (large) {
    return (
      <View style={[{ paddingTop: insets.top + spacing.sm, backgroundColor: colors.background }, style]}>
        {/* Nav row */}
        <View style={styles.navRow}>
          {onBack ? (
            <TouchableOpacity
              onPress={onBack}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel={t('goBack')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </TouchableOpacity>
          ) : (
            <View style={styles.backButton} />
          )}
          <View style={{ flex: 1 }} />
          {rightAction || <View style={styles.backButton} />}
        </View>
        {/* Large title */}
        <View style={styles.largeTitleContainer}>
          <Text
            style={[styles.largeTitle, { color: colors.text }]}
            maxFontSizeMultiplier={1.3}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.subtitle, { color: colors.textSecondary }]}
              maxFontSizeMultiplier={1.5}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm, backgroundColor: colors.background }, style]}>
      {onBack ? (
        <TouchableOpacity
          onPress={onBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('goBack')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
      ) : (
        <View style={styles.backButton} />
      )}
      <Text
        style={[styles.title, { color: colors.text }]}
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
      >
        {title}
      </Text>
      {rightAction || <View style={styles.backButton} />}
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: layout.headerHeight,
    paddingHorizontal: spacing.lg,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: spacing.lg,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontFamily: fonts.semiBold,
    textAlign: 'center',
  },
  largeTitleContainer: {
    paddingHorizontal: layout.screenPaddingHorizontal,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  largeTitle: {
    fontSize: 28,
    fontFamily: fonts.bold,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: fonts.regular,
    marginTop: spacing.xs,
  },
});
