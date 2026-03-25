# rowie-app: Modern UI Refresh with Glassmorphism

## Overview
Modernize rowie-app's visual design with a glassmorphism-inspired aesthetic while maintaining the dark-first approach. Focus on key screens (Menu, Charge, Checkout) with enhanced animations, better elevation/depth, refined typography, and a modern tab bar.

## Design Direction
- **Style**: Glassmorphism - frosted glass effects, translucent cards, subtle blur backgrounds
- **Scope**: Focused polish on key screens while keeping current structure
- **Key Enhancements**: Animations, Cards & Elevation, Typography & Spacing, Navigation

---

## Phase 1: Design System Foundation

### 1.1 Create Glass Card Component
**File:** `src/components/ui/GlassCard.tsx`

A reusable glassmorphism card component with:
- Semi-transparent background with blur effect
- Subtle border with gradient
- Configurable blur intensity and opacity
- Shadow/glow effect for elevation

```typescript
// Props
interface GlassCardProps {
  children: ReactNode;
  variant?: 'default' | 'elevated' | 'subtle';
  blur?: number; // 10-30
  opacity?: number; // 0.1-0.3
  style?: ViewStyle;
}
```

**Visual Spec:**
- Background: `rgba(255, 255, 255, 0.05)` to `rgba(255, 255, 255, 0.1)`
- Border: 1px `rgba(255, 255, 255, 0.1)`
- Blur: 10-20px (via `@react-native-community/blur` or expo-blur)
- Border radius: 20px (more rounded than current 12px)

### 1.2 Update Color System
**File:** `src/lib/colors.ts`

Add glassmorphism-specific colors:
```typescript
// New glass colors
glass: {
  background: 'rgba(255, 255, 255, 0.05)',
  backgroundElevated: 'rgba(255, 255, 255, 0.08)',
  border: 'rgba(255, 255, 255, 0.1)',
  borderLight: 'rgba(255, 255, 255, 0.15)',
  highlight: 'rgba(255, 255, 255, 0.2)',
},
// Enhanced gradients
gradients: {
  primary: ['#2563EB', '#3B82F6'],
  surface: ['#111827', '#0a0a0f'],
  glass: ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.02)'],
}
```

### 1.3 Typography Scale
**File:** `src/lib/typography.ts` (new)

Standardized typography system:
```typescript
export const typography = {
  // Display - Large headers
  displayLarge: { fontSize: 32, fontWeight: '700', lineHeight: 40, letterSpacing: -0.5 },
  displayMedium: { fontSize: 28, fontWeight: '700', lineHeight: 36, letterSpacing: -0.3 },

  // Headings
  h1: { fontSize: 24, fontWeight: '700', lineHeight: 32 },
  h2: { fontSize: 20, fontWeight: '600', lineHeight: 28 },
  h3: { fontSize: 18, fontWeight: '600', lineHeight: 24 },

  // Body
  bodyLarge: { fontSize: 16, fontWeight: '400', lineHeight: 24 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  bodySmall: { fontSize: 14, fontWeight: '400', lineHeight: 20 },

  // Labels
  label: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  labelSmall: { fontSize: 12, fontWeight: '600', lineHeight: 16 },

  // Caption
  caption: { fontSize: 12, fontWeight: '500', lineHeight: 16, letterSpacing: 0.2 },
};
```

### 1.4 Spacing Scale
**File:** `src/lib/spacing.ts` (new)

Consistent spacing system:
```typescript
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 9999,
};
```

---

## Phase 2: Tab Bar Modernization

### 2.1 Modern Floating Tab Bar
**File:** `App.tsx` - TabNavigator section

Transform the bottom tab bar into a modern floating glass design:

**Design Specs:**
- Floating effect: 16px margin from edges
- Glassmorphism background with blur
- Rounded corners: 24px
- Active indicator: Pill-shaped highlight behind active icon
- Icons: Slightly larger (26px), with labels below when active
- Animation: Spring-based tab switching with scale effect

**Implementation:**
```typescript
tabBarStyle: {
  position: 'absolute',
  bottom: 16 + insets.bottom,
  left: 16,
  right: 16,
  height: 70,
  backgroundColor: 'rgba(17, 24, 39, 0.8)',
  borderRadius: 24,
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.1)',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.3,
  shadowRadius: 16,
  elevation: 10,
}
```

**Active Tab Indicator:**
- Animated pill background that slides between tabs
- Subtle glow effect on active icon
- Icon scales up slightly (1.1x) when active
- Label fades in below active icon

---

## Phase 3: Screen Updates

### 3.1 MenuScreen Modernization
**File:** `src/screens/MenuScreen.tsx`

**Header:**
- Glassmorphism header bar with blur
- Catalog selector as pill button with dropdown arrow
- Search icon with glass background

**Category Pills:**
- Glass effect background
- Animated active state with glow
- Horizontal scroll with fade edges

**Product Grid:**
- GlassCard for each product
- Improved image presentation with rounded corners
- Subtle hover/press animation (scale 0.98)
- Price tag with glass pill style
- Add-to-cart button with spring animation

**Animations:**
- Staggered entrance animation for products
- Pull-to-refresh with custom indicator
- Category pill selection with spring bounce

### 3.2 ChargeScreen Modernization
**File:** `src/screens/ChargeScreen.tsx`

**Amount Display:**
- Large display with subtle text shadow
- Animated number transitions (counting effect)
- Currency symbol with reduced opacity

**Keypad:**
- Glass buttons with blur effect
- Ripple/glow effect on press
- Enhanced haptic feedback
- Animated press state (scale + opacity)

**Charge Button:**
- Gradient background (primary colors)
- Glow effect around button
- Loading state with pulse animation
- Disabled state with reduced blur

### 3.3 CheckoutScreen Modernization
**File:** `src/screens/CheckoutScreen.tsx`

**Order Summary Card:**
- GlassCard container
- Item rows with subtle separators
- Animated total calculation

**Tip Selection:**
- Glass pill buttons for percentages
- Selected state with glow border
- Custom tip input with glass styling

**Email Input:**
- Glass-styled input field
- Animated focus state

**Pay Button:**
- Large, prominent with gradient
- Icon animation on ready state
- Pulsing glow when amount > 0

### 3.4 CartScreen Modernization
**File:** `src/screens/CartScreen.tsx`

**Cart Items:**
- GlassCard for each item
- Swipe-to-delete with red glass reveal
- Quantity controls with glass styling

**Summary Section:**
- Floating glass summary card
- Animated price updates
- Checkout button with gradient

---

## Phase 4: Animations & Micro-interactions

### 4.1 Animation Presets
**File:** `src/lib/animations.ts` (new)

```typescript
import { Animated, Easing } from 'react-native';

export const animationPresets = {
  // Spring animations
  springGentle: { tension: 40, friction: 7 },
  springBouncy: { tension: 100, friction: 8 },
  springSnappy: { tension: 150, friction: 10 },

  // Timing animations
  fadeIn: { duration: 200, easing: Easing.out(Easing.ease) },
  scalePress: { duration: 100, easing: Easing.inOut(Easing.ease) },
  slideUp: { duration: 300, easing: Easing.out(Easing.back(1.5)) },
};

// Reusable animation hooks
export const useScaleAnimation = (initialScale = 1) => { ... };
export const useFadeAnimation = (initialOpacity = 0) => { ... };
export const useSlideAnimation = (direction: 'up' | 'down') => { ... };
```

### 4.2 Screen Transitions
- Screens slide up with slight scale
- Modal presentations with blur background
- Tab switches with crossfade

### 4.3 Component Animations
- **Buttons**: Scale down on press (0.96), spring back
- **Cards**: Subtle lift on press (translateY -2)
- **Lists**: Staggered entrance (each item 50ms delay)
- **Loading**: Skeleton shimmer effect
- **Success**: Checkmark with confetti burst

---

## Phase 5: Polish & Details

### 5.1 Blur Integration
**Dependency:** `expo-blur` (already available in Expo)

Use `BlurView` for:
- Tab bar background
- Modal overlays
- Header backgrounds
- Card backgrounds (selective)

### 5.2 Gradient Accents
- Primary buttons: Blue gradient
- Success states: Green gradient glow
- Error states: Red gradient glow
- Card edges: Subtle white gradient border

### 5.3 Shadow System
```typescript
export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  glow: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 0,
  }),
};
```

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/components/ui/GlassCard.tsx` | Create | Reusable glassmorphism card |
| `src/lib/colors.ts` | Modify | Add glass colors and gradients |
| `src/lib/typography.ts` | Create | Typography scale system |
| `src/lib/spacing.ts` | Create | Spacing and radius constants |
| `src/lib/animations.ts` | Create | Animation presets and hooks |
| `src/lib/shadows.ts` | Create | Shadow system |
| `App.tsx` | Modify | Modern floating tab bar |
| `src/screens/MenuScreen.tsx` | Modify | Glassmorphism redesign |
| `src/screens/ChargeScreen.tsx` | Modify | Glass keypad and buttons |
| `src/screens/CheckoutScreen.tsx` | Modify | Glass cards and animations |
| `src/screens/CartScreen.tsx` | Modify | Glass styling |

---

## Implementation Order

1. **Foundation** (Phase 1)
   - Create typography.ts, spacing.ts, shadows.ts
   - Update colors.ts with glass colors
   - Create GlassCard component

2. **Tab Bar** (Phase 2)
   - Implement floating glass tab bar
   - Add tab switching animations

3. **Screens** (Phase 3)
   - MenuScreen updates
   - ChargeScreen updates
   - CheckoutScreen updates
   - CartScreen updates

4. **Animations** (Phase 4)
   - Create animations.ts
   - Add micro-interactions to all screens

5. **Polish** (Phase 5)
   - Fine-tune blur effects
   - Add gradient accents
   - Performance optimization

---

## Visual Reference

### Glass Card Example
```
┌────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  ← Frosted glass effect
│  ░░                            ░░  │
│  ░░   [Product Image]          ░░  │
│  ░░                            ░░  │
│  ░░   Product Name             ░░  │
│  ░░   $12.99    [+ Add]        ░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└────────────────────────────────────┘
 ↑ Subtle white border, blur behind
```

### Floating Tab Bar
```

    ╭─────────────────────────────╮
    │  🏠    ⚡    📋    ⚙️   │     ← Floating with margin
    │ Menu  Charge History Settings│
    ╰─────────────────────────────╯
         ↑ Glass background with blur
```

---

## Performance Considerations

- Use `expo-blur` sparingly (expensive on Android)
- Limit blur to static elements, not scrolling lists
- Use `useNativeDriver: true` for all animations
- Consider fallback for low-end devices (solid color instead of blur)
- Test on real devices for blur performance
