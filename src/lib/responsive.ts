import { Dimensions, PixelRatio } from 'react-native';

// Base dimensions (iPhone 14 Pro as reference)
const BASE_WIDTH = 393;
const BASE_HEIGHT = 852;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Calculate scale factors
const widthScale = SCREEN_WIDTH / BASE_WIDTH;
const heightScale = SCREEN_HEIGHT / BASE_HEIGHT;

// Use the smaller scale to ensure content fits
const scale = Math.min(widthScale, heightScale);

// Detect device type
const minDimension = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT);
export const isTablet = minDimension >= 600;
export const isLargePhone = !isTablet && minDimension >= 380;
export const isSmallPhone = minDimension < 380;

// Scale factor for tablets (they need bigger UI, not just scaled)
const tabletBoost = isTablet ? 1.3 : 1;

/**
 * Scale a size value based on screen width
 * Use for horizontal dimensions, font sizes, and spacing
 */
export function wp(size: number): number {
  const scaledSize = size * widthScale * tabletBoost;
  return Math.round(PixelRatio.roundToNearestPixel(scaledSize));
}

/**
 * Scale a size value based on screen height
 * Use for vertical dimensions
 */
export function hp(size: number): number {
  const scaledSize = size * heightScale * tabletBoost;
  return Math.round(PixelRatio.roundToNearestPixel(scaledSize));
}

/**
 * Scale font size with moderate scaling (less aggressive than wp)
 * Ensures text remains readable on all devices
 */
export function fs(size: number): number {
  // Use a dampened scale factor for fonts
  const fontScale = 1 + (scale * tabletBoost - 1) * 0.5;
  const scaledSize = size * fontScale;
  // Clamp to reasonable bounds
  const minSize = size * 0.85;
  const maxSize = size * (isTablet ? 1.5 : 1.2);
  return Math.round(Math.max(minSize, Math.min(maxSize, scaledSize)));
}

/**
 * Scale spacing values
 */
export function sp(size: number): number {
  const scaledSize = size * scale * tabletBoost;
  return Math.round(PixelRatio.roundToNearestPixel(scaledSize));
}

/**
 * Get responsive value based on device type
 */
export function responsive<T>(phone: T, tablet: T): T {
  return isTablet ? tablet : phone;
}

/**
 * Get responsive value for three device sizes
 */
export function responsiveSize<T>(small: T, regular: T, tablet: T): T {
  if (isTablet) return tablet;
  if (isSmallPhone) return small;
  return regular;
}

// Export screen dimensions
export const screenWidth = SCREEN_WIDTH;
export const screenHeight = SCREEN_HEIGHT;
