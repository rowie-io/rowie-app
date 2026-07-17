import React from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { formatCurrency, isZeroDecimal } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { useTranslations } from '../lib/i18n';

/**
 * Percentage tip grid with live previews — shared between SessionDetail's
 * close-tab tip modal and the settle modal so both flows offer the same
 * one-tap 15/18/20/25% experience instead of a raw number field.
 *
 * Selection model (matches the original close-tab modal):
 *   - a positive number → that percentage of `subtotal`
 *   - `0`  → explicit "No tip"
 *   - `-1` → custom amount (entered in `customText`, base units)
 *   - `null` → nothing picked yet
 *
 * i18n intentionally reuses the existing `sessionDetail` keys (tipPercentLabel,
 * customTip, noTip, …) — both call sites live on that screen and the keys are
 * already translated in all 12 locales.
 */

export const CUSTOM_TIP = -1;

/** Compute the tip in BASE currency units from the current selection. */
export function computeTipBase(
  selectedPct: number | null,
  customText: string,
  subtotal: number,
  currency: string,
): number {
  if (selectedPct === null || selectedPct === 0) return 0;
  if (selectedPct === CUSTOM_TIP) {
    const parsed = parseFloat(customText || '0');
    if (isNaN(parsed) || parsed < 0) return 0;
    return parsed;
  }
  // Percentage of subtotal (NOT subtotal+tax — tipping on tax is rude)
  const raw = subtotal * (selectedPct / 100);
  return isZeroDecimal(currency) ? Math.round(raw) : Math.round(raw * 100) / 100;
}

interface TipPickerProps {
  /** Session subtotal in BASE units — percentage previews derive from this. */
  subtotal: number;
  currency: string;
  percentages: number[];
  allowCustom?: boolean;
  selectedPct: number | null;
  customText: string;
  onSelect: (pct: number) => void;
  onCustomTextChange: (text: string) => void;
}

export function TipPicker({
  subtotal,
  currency,
  percentages,
  allowCustom = true,
  selectedPct,
  customText,
  onSelect,
  onCustomTextChange,
}: TipPickerProps) {
  const { colors } = useTheme();
  const t = useTranslations('sessionDetail');

  const optionStyle = (isActive: boolean) => [
    styles.tipOption,
    {
      borderColor: isActive ? colors.primary : colors.border,
      backgroundColor: isActive ? colors.primary + '15' : colors.surface,
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {percentages.map((pct) => {
          const isActive = selectedPct === pct;
          const preview = computeTipBase(pct, '', subtotal, currency);
          return (
            <TouchableOpacity
              key={pct}
              onPress={() => onSelect(pct)}
              style={optionStyle(isActive)}
              accessibilityRole="button"
              accessibilityLabel={t('tipPercentAccessibility', { pct })}
              accessibilityState={{ selected: isActive }}
            >
              <Text
                style={[styles.optionPct, { color: isActive ? colors.primary : colors.text }]}
                maxFontSizeMultiplier={1.2}
              >
                {t('tipPercentLabel', { pct })}
              </Text>
              <Text
                style={[styles.optionAmount, { color: colors.textMuted }]}
                maxFontSizeMultiplier={1.5}
              >
                {formatCurrency(preview, currency)}
              </Text>
            </TouchableOpacity>
          );
        })}
        {allowCustom && (
          <TouchableOpacity
            onPress={() => onSelect(CUSTOM_TIP)}
            style={optionStyle(selectedPct === CUSTOM_TIP)}
            accessibilityRole="button"
            accessibilityLabel={t('customTipAccessibility')}
            accessibilityState={{ selected: selectedPct === CUSTOM_TIP }}
          >
            <Text
              style={[
                styles.optionPct,
                { color: selectedPct === CUSTOM_TIP ? colors.primary : colors.text },
              ]}
              maxFontSizeMultiplier={1.2}
            >
              {t('customTip')}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => onSelect(0)}
          style={optionStyle(selectedPct === 0)}
          accessibilityRole="button"
          accessibilityLabel={t('noTipAccessibility')}
          accessibilityState={{ selected: selectedPct === 0 }}
        >
          <Text
            style={[styles.optionPct, { color: selectedPct === 0 ? colors.primary : colors.text }]}
            maxFontSizeMultiplier={1.2}
          >
            {t('noTip')}
          </Text>
        </TouchableOpacity>
      </View>

      {selectedPct === CUSTOM_TIP && (
        <View style={styles.customRow}>
          <Text
            style={[styles.customLabel, { color: colors.textSecondary }]}
            maxFontSizeMultiplier={1.5}
          >
            {t('customTipLabel')}
          </Text>
          <TextInput
            value={customText}
            onChangeText={(text) => {
              // Only allow digits + optional decimal for 2-decimal currencies
              const cleaned = isZeroDecimal(currency)
                ? text.replace(/[^0-9]/g, '')
                : text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
              onCustomTextChange(cleaned);
            }}
            placeholder={t('customTipPlaceholder')}
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            style={[
              styles.customInput,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
            accessibilityLabel={t('customTipAccessibility')}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
  },
  tipOption: {
    flexBasis: '30%',
    minHeight: 64,
    borderRadius: 14,
    borderWidth: 2,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  optionPct: {
    fontSize: 17,
    fontFamily: fonts.bold,
  },
  optionAmount: {
    fontSize: 11,
    fontFamily: fonts.regular,
  },
  customRow: {
    gap: 6,
  },
  customLabel: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  customInput: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 18,
    fontFamily: fonts.semiBold,
  },
});
