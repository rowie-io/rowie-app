// Spacing scale for consistent margins and padding
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

// Border radius scale
export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  full: 9999,
} as const;

// Common layout values
export const layout = {
  // Screen padding
  screenPaddingHorizontal: spacing.lg,
  screenPaddingVertical: spacing.lg,

  // Card padding
  cardPadding: spacing.lg,
  cardPaddingSmall: spacing.md,

  // Gap between items
  itemGap: spacing.md,
  sectionGap: spacing.xl,

  // Tab bar
  tabBarHeight: 70,
  tabBarMargin: spacing.lg,

  // Header
  headerHeight: 56,

  // Button heights
  buttonHeight: 48,
  buttonHeightSmall: 40,
  buttonHeightLarge: 56,

  // Input heights
  inputHeight: 48,
  inputHeightSmall: 40,

  // Icon sizes
  iconSizeSmall: 16,
  iconSizeMedium: 20,
  iconSizeLarge: 24,
  iconSizeXLarge: 32,
} as const;

export type SpacingKey = keyof typeof spacing;
export type RadiusKey = keyof typeof radius;
