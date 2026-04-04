// Rowie brand design system — amber/stone warm palette
// Clean & minimal: flat surfaces, thin borders, typography-driven hierarchy

// Brand gradient — matches the wordmark and website
// Use on: buttons, badges, icons, loaders, active states
// Dark mode: full amber→deep orange gradient
export const brandGradient: [string, string] = ['#F59E0B', '#C2410C'];
// Light mode: softer amber→warm amber (less contrast, doesn't look harsh on white)
export const brandGradientLight: [string, string] = ['#F59E0B', '#D97706'];

// Primary amber palette (shared between themes)
const primaryPalette = {
  primary: '#F59E0B',
  primary50: '#FFFBEB',
  primary100: '#FEF3C7',
  primary200: '#FDE68A',
  primary300: '#FCD34D',
  primary400: '#FBBF24',
  primary500: '#F59E0B',
  primary600: '#D97706',
  primary700: '#B45309',
  primary800: '#92400E',
  primary900: '#78350F',
  primary950: '#451A03',
};

// Status colors (shared between themes)
const statusColors = {
  success: '#22c55e',
  successBg: 'rgba(34, 197, 94, 0.1)',
  successLight: '#86efac',
  error: '#ef4444',
  errorBg: 'rgba(239, 68, 68, 0.1)',
  errorLight: '#fca5a5',
  warning: '#f59e0b',
  warningBg: 'rgba(245, 158, 11, 0.1)',
  warningLight: '#fcd34d',
  info: '#F59E0B',
  infoBg: 'rgba(245, 158, 11, 0.1)',
};

// Gray palette (warm stone)
const grayPalette = {
  gray50: '#FAFAF9',
  gray100: '#F5F5F4',
  gray200: '#E7E5E4',
  gray300: '#D6D3D1',
  gray400: '#A8A29E',
  gray500: '#78716C',
  gray600: '#57534E',
  gray700: '#44403C',
  gray800: '#292524',
  gray900: '#1C1917',
  gray950: '#0C0A09',
};

// Dark theme colors
export const darkColors = {
  ...primaryPalette,
  ...statusColors,
  ...grayPalette,

  // Semantic colors
  background: '#1C1917',
  surface: '#292524',
  surfaceSecondary: '#292524',
  surfaceElevated: '#292524',
  surfaceTertiary: '#1C1917',

  // Card styling
  card: '#292524',
  cardBorder: '#44403C',
  cardHover: '#44403C',

  // Borders
  border: '#44403C',
  borderLight: '#57534E',
  borderSubtle: '#292524',
  divider: '#292524',

  // Text
  text: '#F5F5F4',
  textSecondary: '#A8A29E',
  textMuted: '#78716C',
  textInverse: '#1C1917',

  // Input
  inputBackground: '#292524',
  inputBorder: '#44403C',
  inputText: '#F5F5F4',
  inputPlaceholder: '#78716C',

  // Tab bar
  tabBar: '#292524',
  tabBarBorder: '#44403C',
  tabInactive: '#78716C',
  tabActive: '#F59E0B',

  // Chips
  chipBg: '#292524',
  chipBgActive: 'rgba(245, 158, 11, 0.15)',

  // Buttons
  buttonSecondaryBg: '#292524',

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.7)',
  backdrop: 'rgba(0, 0, 0, 0.5)',

  // Shadows
  shadow: 'rgba(0, 0, 0, 0.5)',
  shadowPrimary: 'rgba(245, 158, 11, 0.25)',

  // Keypad
  keypadButton: '#292524',
  keypadButtonPressed: '#44403C',
};

// Light theme colors
export const lightColors = {
  ...primaryPalette,
  ...statusColors,
  ...grayPalette,

  // Semantic colors
  background: '#FAFAF9',
  surface: '#FAFAF9',
  surfaceSecondary: '#F5F5F4',
  surfaceElevated: '#FFFFFF',
  surfaceTertiary: '#FAFAF9',

  // Card styling
  card: '#FFFFFF',
  cardBorder: '#E7E5E4',
  cardHover: '#FAFAF9',

  // Borders
  border: '#E7E5E4',
  borderLight: '#F5F5F4',
  borderSubtle: '#F5F5F4',
  divider: '#F5F5F4',

  // Text
  text: '#1C1917',
  textSecondary: '#57534E',
  textMuted: '#78716C',
  textInverse: '#F5F5F4',

  // Input
  inputBackground: '#FFFFFF',
  inputBorder: '#D6D3D1',
  inputText: '#1C1917',
  inputPlaceholder: '#A8A29E',

  // Tab bar
  tabBar: '#FFFFFF',
  tabBarBorder: '#E7E5E4',
  tabInactive: '#78716C',
  tabActive: '#F59E0B',

  // Chips
  chipBg: '#F5F5F4',
  chipBgActive: 'rgba(245, 158, 11, 0.1)',

  // Buttons
  buttonSecondaryBg: '#F5F5F4',

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.5)',
  backdrop: 'rgba(0, 0, 0, 0.3)',

  // Shadows
  shadow: 'rgba(0, 0, 0, 0.1)',
  shadowPrimary: 'rgba(245, 158, 11, 0.15)',

  // Keypad
  keypadButton: '#F5F5F4',
  keypadButtonPressed: '#E7E5E4',
};

// Type for theme colors
export type ThemeColors = typeof darkColors;

// Helper to get colors by theme
export const getColors = (isDark: boolean): ThemeColors => {
  return isDark ? darkColors : lightColors;
};

// Default export for backward compatibility (dark theme)
export const colors = darkColors;
