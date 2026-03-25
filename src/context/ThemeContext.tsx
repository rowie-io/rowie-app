import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme, Platform } from 'react-native';
import { darkColors, lightColors, ThemeColors } from '../lib/colors';
import logger from '../lib/logger';

// Alternate app icons - import the setter function
let setAlternateAppIcon: ((iconName: string) => Promise<void>) | null = null;
if (Platform.OS === 'ios') {
  try {
    const alternateIcons = require('expo-alternate-app-icons');
    setAlternateAppIcon = alternateIcons.setAlternateAppIcon;
  } catch (e) {
    logger.warn('[ThemeContext] expo-alternate-app-icons not available');
  }
}

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'theme_preference';

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemColorScheme = useColorScheme();
  const [theme, setThemeState] = useState<ThemeMode>('dark');
  const [isLoaded, setIsLoaded] = useState(false);

  // Determine if we should use dark mode
  const isDark = theme === 'system'
    ? systemColorScheme === 'dark'
    : theme === 'dark';

  // Get the appropriate colors
  const colors = isDark ? darkColors : lightColors;

  // Load saved theme preference
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme)) {
          setThemeState(savedTheme as ThemeMode);
        }
      } catch (error) {
        logger.error('Failed to load theme preference:', error);
      } finally {
        setIsLoaded(true);
      }
    };
    loadTheme();
  }, []);

  // Update app icon when theme changes (iOS only, real devices)
  useEffect(() => {
    if (setAlternateAppIcon && isLoaded) {
      setAlternateAppIcon(isDark ? 'dark' : 'light').catch(() => {
        // Expected to fail in simulator — alternate icons only work on physical devices
      });
    }
  }, [isDark, isLoaded]);

  // Save theme preference
  const setTheme = useCallback(async (newTheme: ThemeMode) => {
    setThemeState(newTheme);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch (error) {
      logger.error('Failed to save theme preference:', error);
    }
  }, []);

  // Toggle between light and dark (skips system)
  const toggleTheme = useCallback(() => {
    const newTheme = isDark ? 'light' : 'dark';
    setTheme(newTheme);
  }, [isDark, setTheme]);

  const value = useMemo(() => ({ theme, isDark, colors, setTheme, toggleTheme }), [theme, isDark, colors, setTheme, toggleTheme]);

  // Don't render until theme is loaded to prevent flash
  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
