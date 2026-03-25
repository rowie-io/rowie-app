import { ViewStyle } from 'react-native';

// Shadow presets for elevation
export const shadows = {
  // Small shadow - subtle elevation
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  } as ViewStyle,

  // Medium shadow - cards and containers
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  } as ViewStyle,

  // Large shadow - floating elements
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  } as ViewStyle,

  // Extra large - modals and overlays
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 12,
  } as ViewStyle,

  // No shadow
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  } as ViewStyle,
};

// Glow effect generator - for buttons and active states
export const glow = (color: string, intensity: 'subtle' | 'medium' | 'strong' = 'medium'): ViewStyle => {
  const opacityMap = {
    subtle: 0.2,
    medium: 0.35,
    strong: 0.5,
  };

  const radiusMap = {
    subtle: 8,
    medium: 12,
    strong: 20,
  };

  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: opacityMap[intensity],
    shadowRadius: radiusMap[intensity],
    elevation: 0, // Glow doesn't need elevation
  };
};

// Primary button glow
export const primaryGlow = glow('#2563EB', 'medium');

// Success glow
export const successGlow = glow('#22c55e', 'medium');

// Error glow
export const errorGlow = glow('#ef4444', 'medium');

export type ShadowKey = keyof typeof shadows;
