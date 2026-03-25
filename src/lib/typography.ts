import { TextStyle } from 'react-native';
import { fonts } from '../../App';

// Typography scale with font families
export const typography = {
  // Display - Large headers
  displayLarge: {
    fontSize: 32,
    fontFamily: fonts.bold,
    lineHeight: 40,
    letterSpacing: -0.5,
  } as TextStyle,
  displayMedium: {
    fontSize: 28,
    fontFamily: fonts.bold,
    lineHeight: 36,
    letterSpacing: -0.3,
  } as TextStyle,

  // Headings
  h1: {
    fontSize: 24,
    fontFamily: fonts.bold,
    lineHeight: 32,
  } as TextStyle,
  h2: {
    fontSize: 20,
    fontFamily: fonts.semiBold,
    lineHeight: 28,
  } as TextStyle,
  h3: {
    fontSize: 18,
    fontFamily: fonts.semiBold,
    lineHeight: 24,
  } as TextStyle,

  // Body
  bodyLarge: {
    fontSize: 16,
    fontFamily: fonts.regular,
    lineHeight: 24,
  } as TextStyle,
  body: {
    fontSize: 15,
    fontFamily: fonts.regular,
    lineHeight: 22,
  } as TextStyle,
  bodySmall: {
    fontSize: 14,
    fontFamily: fonts.regular,
    lineHeight: 20,
  } as TextStyle,

  // Labels
  label: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    lineHeight: 20,
  } as TextStyle,
  labelSmall: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    lineHeight: 16,
  } as TextStyle,

  // Caption
  caption: {
    fontSize: 12,
    fontFamily: fonts.medium,
    lineHeight: 16,
    letterSpacing: 0.2,
  } as TextStyle,

  // Button text
  button: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    lineHeight: 20,
  } as TextStyle,
  buttonLarge: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    lineHeight: 24,
  } as TextStyle,

  // Numeric displays (for amounts)
  amount: {
    fontSize: 48,
    fontFamily: fonts.bold,
    lineHeight: 56,
    letterSpacing: -1,
  } as TextStyle,
  amountSmall: {
    fontSize: 32,
    fontFamily: fonts.bold,
    lineHeight: 40,
    letterSpacing: -0.5,
  } as TextStyle,
};

export type TypographyKey = keyof typeof typography;
