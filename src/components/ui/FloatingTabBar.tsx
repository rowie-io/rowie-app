import React, { useEffect, useRef, useState, memo } from 'react';
import {
  View,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Keyboard,
  Platform,
  LayoutChangeEvent,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { shadows } from '../../lib/shadows';
import { fonts } from '../../lib/fonts';
import { useTranslations } from '../../lib/i18n';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

const TAB_BAR_HEIGHT = 60;
const ICON_SIZE = 22;
const TAB_MARGIN_HORIZONTAL = 16;
const TAB_MARGIN_BOTTOM = 4;

const ROUTE_ICONS: Record<string, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap; labelKey: string }> = {
  Menu: { active: 'storefront', inactive: 'storefront-outline', labelKey: 'menuLabel' },
  TabsTab: { active: 'receipt', inactive: 'receipt-outline', labelKey: 'tabsLabel' },
  Preorders: { active: 'bag-handle', inactive: 'bag-handle-outline', labelKey: 'ordersLabel' },
  History: { active: 'time', inactive: 'time-outline', labelKey: 'historyLabel' },
  Events: { active: 'ticket', inactive: 'ticket-outline', labelKey: 'eventsLabel' },
  Settings: { active: 'person-circle', inactive: 'person-circle-outline', labelKey: 'accountLabel' },
};

export const FloatingTabBar = memo(function FloatingTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const { colors, isDark } = useTheme();
  const t = useTranslations('components.floatingTabBar');
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

  // Animated values
  const indicatorX = useRef(new Animated.Value(0)).current;

  // Hide tab bar when keyboard is visible
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showListener = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideListener = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

  // Animate indicator when tab changes
  useEffect(() => {
    if (containerWidth === 0) return;
    const tabWidth = containerWidth / state.routes.length;
    const targetX = state.index * tabWidth;

    Animated.spring(indicatorX, {
      toValue: targetX,
      tension: 300,
      friction: 25,
      useNativeDriver: true,
    }).start();
  }, [state.index, containerWidth, state.routes.length, indicatorX]);

  const handleLayout = (e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  };

  if (keyboardVisible) return null;

  const tabWidth = containerWidth > 0 ? containerWidth / state.routes.length : 0;

  return (
    <View
      style={[
        styles.outerContainer,
        { bottom: insets.bottom + 4 },
      ]}
    >
      <View
        style={[
          styles.container,
          {
            backgroundColor: isDark ? '#292524' : '#FFFFFF',
            borderColor: isDark ? '#3a3533' : '#E7E5E4',
            ...shadows.lg,
          },
        ]}
        onLayout={handleLayout}
      >
        {/* Sliding indicator behind active tab */}
        {tabWidth > 0 && (
          <Animated.View
            style={[
              styles.indicator,
              {
                width: tabWidth - 12,
                backgroundColor: isDark ? 'rgba(249, 115, 22, 0.12)' : 'rgba(249, 115, 22, 0.08)',
                borderColor: isDark ? 'rgba(249, 115, 22, 0.25)' : 'rgba(249, 115, 22, 0.2)',
                transform: [{ translateX: Animated.add(indicatorX, 6) }],
              },
            ]}
            pointerEvents="none"
          />
        )}

        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const routeConfig = ROUTE_ICONS[route.name] || { active: 'ellipse', inactive: 'ellipse-outline', labelKey: route.name };
          const label = t(routeConfig.labelKey);

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel || label}
              style={styles.tab}
              activeOpacity={0.6}
            >
              <Ionicons
                name={isFocused ? routeConfig.active : routeConfig.inactive}
                size={ICON_SIZE}
                color={isFocused ? colors.primary : colors.textMuted}
              />
              <Text
                style={[
                  styles.label,
                  {
                    color: isFocused ? colors.primary : colors.textMuted,
                    fontFamily: isFocused ? fonts.semiBold : fonts.medium,
                  },
                ]}
                maxFontSizeMultiplier={1.2}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
});

// Enough padding so content never hides behind the tab bar
// TAB_BAR_HEIGHT(60) + bottom offset(8) + breathing room(12)
export const FLOATING_TAB_BAR_HEIGHT = TAB_BAR_HEIGHT + 8 + 12;

const styles = StyleSheet.create({
  outerContainer: {
    position: 'absolute',
    left: TAB_MARGIN_HORIZONTAL,
    right: TAB_MARGIN_HORIZONTAL,
  },
  container: {
    height: TAB_BAR_HEIGHT,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  indicator: {
    position: 'absolute',
    top: 6,
    height: TAB_BAR_HEIGHT - 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: TAB_BAR_HEIGHT,
    gap: 2,
  },
  label: {
    fontSize: 10,
    letterSpacing: 0.1,
  },
});
