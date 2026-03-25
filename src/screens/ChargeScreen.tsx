import React, { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Animated,
  useWindowDimensions,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { formatCents, getCurrencySymbol, isZeroDecimal, fromSmallestUnit } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { glass } from '../lib/colors';
import { shadows, glow } from '../lib/shadows';
import { PayoutsSetupBanner } from '../components/PayoutsSetupBanner';
import { SetupRequiredBanner } from '../components/SetupRequiredBanner';
import { StarBackground } from '../components/StarBackground';
import { useTapToPayGuard } from '../hooks';

// Responsive sizing constants
const MIN_BUTTON_SIZE = 56;
const MAX_BUTTON_SIZE = 130; // Larger for tablets/iPads
const MIN_GAP = 10;
const MAX_GAP = 28;

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['C', '0', 'DEL'],
];

// Animated keypad button component
interface KeypadButtonProps {
  keyValue: string;
  onPress: (key: string) => void;
  colors: any;
  buttonSize: number;
  glassColors: typeof glass.dark;
}

const KeypadButton = memo(function KeypadButton({ keyValue, onPress, colors, buttonSize, glassColors }: KeypadButtonProps) {
  const scale = React.useRef(new Animated.Value(1)).current;

  // Scale font sizes based on button size
  const numberFontSize = Math.round(buttonSize * 0.32);
  const actionFontSize = Math.round(buttonSize * 0.2);
  const iconSize = Math.round(buttonSize * 0.32);
  const borderRadius = Math.round(buttonSize * 0.25);

  const handlePressIn = useCallback(() => {
    Animated.spring(scale, {
      toValue: 0.9,
      useNativeDriver: true,
      tension: 150,
      friction: 10,
    }).start();
  }, [scale]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start();
  }, [scale]);

  const handlePress = useCallback(() => {
    // Light haptic for numbers, medium for actions
    if (keyValue === 'C' || keyValue === 'DEL') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress(keyValue);
  }, [keyValue, onPress]);

  const isAction = keyValue === 'C' || keyValue === 'DEL';

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={keyValue === 'DEL' ? 'Delete' : keyValue === 'C' ? 'Clear' : keyValue}
        style={({ pressed }) => [
          {
            width: buttonSize,
            height: buttonSize,
            borderRadius: borderRadius,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: pressed
              ? glassColors.backgroundElevated
              : glassColors.background,
            borderWidth: 1,
            borderColor: pressed ? glassColors.borderLight : glassColors.border,
            ...shadows.sm,
          },
        ]}
      >
        {keyValue === 'DEL' ? (
          <Ionicons
            name="backspace-outline"
            size={iconSize}
            color={colors.textSecondary}
          />
        ) : (
          <Text
            style={{
              fontSize: isAction ? actionFontSize : numberFontSize,
              fontFamily: isAction ? fonts.medium : fonts.semiBold,
              color: isAction ? colors.textSecondary : colors.text,
            }}
            maxFontSizeMultiplier={1.3}
          >
            {keyValue}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
});

export function ChargeScreen() {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const { isPaymentReady, connectLoading, connectStatus, currency } = useAuth();
  const { guardCheckout } = useTapToPayGuard();
  const insets = useSafeAreaInsets();
  const glassColors = isDark ? glass.dark : glass.light;
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [amount, setAmount] = useState('');

  // Reset amount when leaving the screen
  useFocusEffect(
    useCallback(() => {
      // Called when screen gains focus - do nothing
      return () => {
        // Cleanup called when screen loses focus - reset the form
        setAmount('');
      };
    }, [])
  );

  // Calculate responsive sizes based on screen dimensions
  const responsiveSizes = useMemo(() => {
    const minDimension = Math.min(screenWidth, screenHeight);
    const isTablet = minDimension >= 600;
    const isLargeTablet = minDimension >= 768; // iPad vs iPad mini
    const isLargePhone = !isTablet && minDimension >= 380;

    // Max button size varies by device type - larger for big screens
    const maxSize = isLargeTablet ? MAX_BUTTON_SIZE : isTablet ? 105 : isLargePhone ? 88 : 72;
    const maxGap = isLargeTablet ? MAX_GAP : isTablet ? 20 : isLargePhone ? 16 : 14;

    // Reserved space for fixed elements
    const headerHeight = isTablet ? 70 : 60;
    const footerHeight = isTablet ? 150 : 130;
    const amountDisplayHeight = isTablet ? 110 : 70;
    const safeAreaBuffer = isTablet ? 60 : 50;

    // Available height for keypad (4 rows + gaps)
    const availableHeight = screenHeight - headerHeight - footerHeight - amountDisplayHeight - safeAreaBuffer;

    // Available width for 3 buttons + gaps - use more screen width
    const horizontalPadding = isLargeTablet ? 120 : isTablet ? 80 : 48;
    const availableWidth = screenWidth - horizontalPadding;

    // Divisors account for 4 buttons + gaps between them
    const heightDivisor = isTablet ? 5.0 : 4.5;
    const widthDivisor = isTablet ? 3.5 : 3.3;
    const maxButtonFromHeight = availableHeight / heightDivisor;
    const maxButtonFromWidth = availableWidth / widthDivisor;

    // Use the smaller of the two constraints, then clamp to min/max for device type
    const constrainedSize = Math.min(maxButtonFromHeight, maxButtonFromWidth);
    const buttonSize = Math.max(MIN_BUTTON_SIZE, Math.min(maxSize, constrainedSize));

    // Calculate gap proportionally
    const gapRatio = (buttonSize - MIN_BUTTON_SIZE) / (maxSize - MIN_BUTTON_SIZE);
    const buttonGap = MIN_GAP + (maxGap - MIN_GAP) * Math.max(0, Math.min(1, gapRatio));

    // Amount font sizes scale with button size
    const amountFontSize = Math.round(buttonSize * 0.72);
    const currencyFontSize = Math.round(buttonSize * 0.48);

    return { buttonSize, buttonGap, amountFontSize, currencyFontSize };
  }, [screenWidth, screenHeight]);

  const formatAmount = (value: string) => {
    const digits = value.replace(/\D/g, '');
    const rawCents = parseInt(digits || '0', 10);
    return isZeroDecimal(currency) ? String(rawCents) : (rawCents / 100).toFixed(2);
  };

  const displayAmount = formatAmount(amount);
  const formattedAmount = formatCents(parseInt(amount || '0', 10), currency);
  const cents = parseInt(amount || '0', 10);

  const handleKeypadPress = (key: string) => {
    if (key === 'DEL') {
      setAmount((prev) => prev.slice(0, -1));
    } else if (key === 'C') {
      setAmount('');
    } else {
      // Limit to reasonable amount (prevent overflow)
      if (amount.length < 8) {
        setAmount((prev) => prev + key);
      }
    }
  };

  const handleCharge = () => {
    if (cents < 50) {
      Alert.alert('Invalid Amount', `Minimum charge is ${formatCents(50, currency)}`);
      return;
    }

    if (!guardCheckout()) return;

    // Navigate to checkout screen with quick charge params
    // This ensures tip/email screens are shown based on catalog settings
    navigation.navigate('Checkout', {
      total: cents,
      isQuickCharge: true,
      quickChargeDescription: `Quick Charge - ${formattedAmount}`,
    });

    // Reset form after navigation
    setAmount('');
  };

  const styles = createStyles(colors, glassColors, responsiveSizes, isDark);

  // Show setup required banner when charges aren't enabled
  const showSetupBanner = !connectLoading && connectStatus && !connectStatus.chargesEnabled;

  // Show payouts banner when charges are enabled but payouts aren't (user can still accept payments)
  const showPayoutsBanner = !connectLoading && isPaymentReady && connectStatus && !connectStatus.payoutsEnabled;

  // Disable charge button only if amount too low
  // Per Apple TTPOi 5.3: Button must never be grayed out based on setup status
  const chargeDisabled = cents < 50;

  return (
    <StarBackground colors={colors} isDark={isDark}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Setup Required Banner (charges not enabled) */}
        {showSetupBanner && <SetupRequiredBanner compact />}

        {/* Payouts Setup Banner (can accept payments but no payouts yet) */}
        {showPayoutsBanner && <PayoutsSetupBanner compact />}

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title} maxFontSizeMultiplier={1.3}>Quick Charge</Text>
      </View>

      {/* Centered Content - Amount & Keypad */}
      <View style={styles.mainContent}>
        {/* Amount Display */}
        <View style={styles.amountContainer} accessibilityRole="summary" accessibilityLabel={`Amount ${formattedAmount}`}>
          <Text style={[styles.currencySymbol, { fontSize: responsiveSizes.currencyFontSize }]} maxFontSizeMultiplier={1.2}>{getCurrencySymbol(currency)}</Text>
          <Text style={[styles.amount, { fontSize: responsiveSizes.amountFontSize }]} maxFontSizeMultiplier={1.2}>{displayAmount}</Text>
        </View>

        {/* Keypad */}
        <View style={styles.keypad}>
          {KEYPAD_ROWS.map((row, rowIndex) => (
            <View key={rowIndex} style={[styles.keypadRow, { gap: responsiveSizes.buttonGap }]}>
              {row.map((key) => (
                <KeypadButton
                  key={key}
                  keyValue={key}
                  onPress={handleKeypadPress}
                  colors={colors}
                  buttonSize={responsiveSizes.buttonSize}
                  glassColors={glassColors}
                />
              ))}
            </View>
          ))}
        </View>
      </View>

      {/* Charge Button - Fixed at Bottom */}
      <View style={styles.footer}>
        <Pressable
          onPress={() => {
            if (!chargeDisabled) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              handleCharge();
            }
          }}
          disabled={chargeDisabled}
          accessibilityRole="button"
          accessibilityLabel={cents < 50 ? 'Enter amount' : `Charge ${formattedAmount}`}
          accessibilityState={{ disabled: chargeDisabled }}
          style={({ pressed }) => [
            styles.chargeButton,
            { backgroundColor: chargeDisabled ? glassColors.backgroundElevated : (isDark ? '#fff' : '#09090b') },
            pressed && !chargeDisabled && styles.chargeButtonPressed,
          ]}
        >
          <Ionicons name="flash" size={22} color={chargeDisabled ? colors.textMuted : (isDark ? '#09090b' : '#fff')} />
          <Text style={[styles.chargeButtonText, { color: chargeDisabled ? colors.textMuted : (isDark ? '#09090b' : '#fff') }]} maxFontSizeMultiplier={1.3}>
            {cents < 50 ? 'Enter Amount' : `Charge ${formattedAmount}`}
          </Text>
        </Pressable>

        <Text style={[styles.minimumHint, { opacity: cents > 0 && cents < 50 ? 1 : 0 }]} maxFontSizeMultiplier={1.5} accessibilityRole={cents > 0 && cents < 50 ? 'alert' : 'text'}>
          {`Minimum charge is ${formatCents(50, currency)}`}
        </Text>
      </View>
      </View>
    </StarBackground>
  );
}

interface ResponsiveSizes {
  buttonSize: number;
  buttonGap: number;
  amountFontSize: number;
  currencyFontSize: number;
}

const createStyles = (colors: any, glassColors: typeof glass.dark, sizes: ResponsiveSizes, isDark: boolean) => {
  const headerBackground = isDark ? '#09090b' : colors.background;
  const cardBackground = isDark ? '#181819' : 'rgba(255,255,255,0.85)';
  const cardBorder = isDark ? '#1d1d1f' : 'rgba(0,0,0,0.08)';

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    mainContent: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 56,
      paddingHorizontal: 16,
      backgroundColor: headerBackground,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    },
    title: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    amountContainer: {
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
      paddingHorizontal: 20,
      paddingVertical: Math.round(sizes.buttonGap * 1.5),
    },
    currencySymbol: {
      fontFamily: fonts.bold,
      color: colors.textMuted,
      marginRight: 2,
      marginTop: 4,
    },
    amount: {
      fontFamily: fonts.bold,
      color: colors.text,
      letterSpacing: -2,
    },
    keypad: {
      paddingHorizontal: 24,
      paddingBottom: sizes.buttonGap,
    },
    keypadRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginBottom: sizes.buttonGap,
    },
    footer: {
      paddingHorizontal: 20,
      paddingBottom: 24,
      paddingTop: 12,
    },
    chargeButton: {
      flexDirection: 'row',
      borderRadius: 16,
      paddingVertical: 18,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      ...shadows.md,
    },
    chargeButtonPressed: {
      opacity: 0.9,
      transform: [{ scale: 0.98 }],
    },
    chargeButtonText: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
    },
    minimumHint: {
      textAlign: 'center',
      marginTop: 12,
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },
  });
};
