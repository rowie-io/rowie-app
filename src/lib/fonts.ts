import { Dimensions, PixelRatio } from 'react-native';

// Plus Jakarta Sans font family names for use in styles
export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semiBold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extraBold: 'PlusJakartaSans_800ExtraBold',
} as const;

// Font weights mapped to Plus Jakarta Sans variants
export const fontWeights = {
  400: fonts.regular,
  500: fonts.medium,
  600: fonts.semiBold,
  700: fonts.bold,
  800: fonts.extraBold,
} as const;

// Responsive font scaling for tablets
const { width, height } = Dimensions.get('window');
const minDimension = Math.min(width, height);
const isTablet = minDimension >= 600;

// Scale factor: tablets get 1.25x font sizes
const fontScale = isTablet ? 1.25 : 1;

/**
 * Scale a font size for the current device
 * Use this for all font sizes to ensure proper scaling on tablets
 */
export function scaledFontSize(baseSize: number): number {
  return Math.round(PixelRatio.roundToNearestPixel(baseSize * fontScale));
}

// Pre-scaled common font sizes for convenience
export const fontSizes = {
  xs: scaledFontSize(11),
  sm: scaledFontSize(13),
  base: scaledFontSize(15),
  md: scaledFontSize(16),
  lg: scaledFontSize(18),
  xl: scaledFontSize(20),
  '2xl': scaledFontSize(24),
  '3xl': scaledFontSize(28),
  '4xl': scaledFontSize(32),
  '5xl': scaledFontSize(40),
} as const;

// Export tablet detection for other uses
export { isTablet };
