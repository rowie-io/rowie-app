import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Platform, Animated, Text, Dimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Stripe React Native only works on native platforms with dev builds (not Expo Go)
import Constants from 'expo-constants';
const isExpoGo = Constants.appOwnership === 'expo';
let StripeProvider: any = ({ children }: { children: React.ReactNode }) => <>{children}</>;
if (Platform.OS !== 'web' && !isExpoGo) {
  try {
    StripeProvider = require('@stripe/stripe-react-native').StripeProvider;
  } catch {
    // Native module not available
  }
}
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';

import { QueryProvider } from './src/providers/QueryProvider';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { CatalogProvider, useCatalog } from './src/context/CatalogContext';
import { CartProvider } from './src/context/CartContext';
import { DeviceProvider, useDevice } from './src/context/DeviceContext';
import { SocketProvider } from './src/context/SocketContext';
import { PreordersProvider, usePreorders } from './src/context/PreordersContext';
import { SocketEventHandlers } from './src/components/SocketEventHandlers';
import { StripeTerminalContextProvider, useTerminal } from './src/context/StripeTerminalContext';
import { NetworkStatus } from './src/components/NetworkStatus';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { DataPrefetcher } from './src/components/DataPrefetcher';
import { config } from './src/lib/config';

// Auth screens
import { LoginScreen } from './src/screens/LoginScreen';
import { SignUpScreen } from './src/screens/SignUpScreen';
import { ForgotPasswordScreen } from './src/screens/ForgotPasswordScreen';
import { ResetPasswordScreen } from './src/screens/ResetPasswordScreen';

// Main screens
import { CatalogSelectScreen } from './src/screens/CatalogSelectScreen';
import { MenuScreen } from './src/screens/MenuScreen';
// ChargeScreen functionality moved to QuickChargeBottomSheet in MenuScreen
import { TransactionsScreen } from './src/screens/TransactionsScreen';
import { TransactionDetailScreen } from './src/screens/TransactionDetailScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TapToPaySettingsScreen } from './src/screens/TapToPaySettingsScreen';
import { UpgradeScreen } from './src/screens/UpgradeScreen';
import { StripeOnboardingScreen } from './src/screens/StripeOnboardingScreen';

// Payment flow screens
import { CheckoutScreen } from './src/screens/CheckoutScreen';
import { PaymentProcessingScreen } from './src/screens/PaymentProcessingScreen';
import { PaymentResultScreen } from './src/screens/PaymentResultScreen';
import { CashPaymentScreen } from './src/screens/CashPaymentScreen';
import { SplitPaymentScreen } from './src/screens/SplitPaymentScreen';

// Events screens
import { EventsScannerScreen } from './src/screens/EventsScannerScreen';

// Preorder screens
import { PreordersScreen } from './src/screens/PreordersScreen';
import { PreorderDetailScreen } from './src/screens/PreorderDetailScreen';

// Education screens
import { TapToPayEducationScreen } from './src/screens/TapToPayEducationScreen';

// Reader management
import { ReaderManagementScreen } from './src/screens/ReaderManagementScreen';

// Onboarding components
import { SetupPaymentsModal } from './src/components/SetupPaymentsModal';

// Keep splash screen visible while loading fonts
SplashScreen.preventAutoHideAsync();

// Star component for Apple-style sparkle effect
function Star({ style, size = 8, color = 'rgba(255,255,255,0.8)' }: { style?: any; size?: number; color?: string }) {
  return (
    <View style={[{ position: 'absolute' }, style]}>
      <View style={{
        width: size,
        height: size,
        backgroundColor: color,
        borderRadius: size / 2,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: size * 1.5,
      }} />
    </View>
  );
}

// Four-point star for larger sparkles
function FourPointStar({ style, size = 16, color = 'rgba(255,255,255,0.9)' }: { style?: any; size?: number; color?: string }) {
  return (
    <View style={[{ position: 'absolute', width: size, height: size }, style]}>
      <View style={{
        position: 'absolute',
        left: size / 2 - 1,
        top: 0,
        width: 2,
        height: size,
        backgroundColor: color,
        borderRadius: 1,
      }} />
      <View style={{
        position: 'absolute',
        top: size / 2 - 1,
        left: 0,
        width: size,
        height: 2,
        backgroundColor: color,
        borderRadius: 1,
      }} />
      <View style={{
        position: 'absolute',
        left: size / 2 - 2,
        top: size / 2 - 2,
        width: 4,
        height: 4,
        backgroundColor: color,
        borderRadius: 2,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: size / 2,
      }} />
    </View>
  );
}

// Central glowing star for loading
function GlowingStar({ size = 32, color, glowColor, pulseAnim }: { size?: number; color: string; glowColor: string; pulseAnim: Animated.Value }) {
  return (
    <Animated.View style={{
      width: size * 2,
      height: size * 2,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: pulseAnim,
      transform: [{ scale: pulseAnim }],
    }}>
      {/* Outer glow */}
      <View style={{
        position: 'absolute',
        width: size * 1.5,
        height: size * 1.5,
        borderRadius: size,
        backgroundColor: glowColor,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: size,
      }} />
      {/* Vertical line */}
      <View style={{
        position: 'absolute',
        width: 3,
        height: size,
        backgroundColor: color,
        borderRadius: 1.5,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
      }} />
      {/* Horizontal line */}
      <View style={{
        position: 'absolute',
        width: size,
        height: 3,
        backgroundColor: color,
        borderRadius: 1.5,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
      }} />
      {/* Center bright point */}
      <View style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: color,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 10,
      }} />
    </Animated.View>
  );
}

// Loading screen with stars animation
function LoadingScreen({ colors, isDark }: { colors: any; isDark: boolean }) {
  const sparkleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.7)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(sparkleAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(sparkleAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 8000,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const starColor = isDark ? '#fff' : colors.primary;
  const glowColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(99,102,241,0.2)';

  return (
    <Animated.View style={[styles.loadingScreen, { backgroundColor: isDark ? '#09090b' : colors.background, opacity: fadeAnim }]}>
      <LinearGradient
        colors={isDark
          ? ['transparent', 'rgba(99, 102, 241, 0.08)', 'rgba(139, 92, 246, 0.05)', 'transparent']
          : ['transparent', 'rgba(99, 102, 241, 0.05)', 'rgba(139, 92, 246, 0.03)', 'transparent']
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View style={[StyleSheet.absoluteFill, { opacity: sparkleAnim }]}>
        <FourPointStar style={{ top: 120, left: 30 }} size={14} color={isDark ? 'rgba(255,255,255,0.7)' : 'rgba(99,102,241,0.4)'} />
        <Star style={{ top: 180, left: 70 }} size={4} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(99,102,241,0.3)'} />
        <Star style={{ top: 150, right: 50 }} size={6} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(139,92,246,0.35)'} />
        <FourPointStar style={{ top: 220, right: 35 }} size={12} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(99,102,241,0.3)'} />
        <Star style={{ top: 280, left: 45 }} size={3} color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(139,92,246,0.25)'} />
        <Star style={{ top: 170, left: SCREEN_WIDTH * 0.45 }} size={5} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(99,102,241,0.3)'} />
        <Star style={{ top: 320, right: 80 }} size={4} color={isDark ? 'rgba(255,255,255,0.45)' : 'rgba(139,92,246,0.25)'} />
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.subtract(1, sparkleAnim) }]}>
        <Star style={{ top: 140, left: 50 }} size={5} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(99,102,241,0.3)'} />
        <FourPointStar style={{ top: 200, right: 40 }} size={16} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(139,92,246,0.35)'} />
        <Star style={{ top: 260, left: 30 }} size={4} color={isDark ? 'rgba(255,255,255,0.45)' : 'rgba(99,102,241,0.25)'} />
        <Star style={{ top: 190, left: SCREEN_WIDTH * 0.55 }} size={6} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(139,92,246,0.3)'} />
        <FourPointStar style={{ top: 130, right: 90 }} size={10} color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(99,102,241,0.25)'} />
        <Star style={{ top: 300, right: 55 }} size={3} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(139,92,246,0.25)'} />
        <Star style={{ top: 240, left: 90 }} size={5} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(99,102,241,0.3)'} />
      </Animated.View>

      <View style={styles.loadingContent}>
        <Animated.View style={{ transform: [{ rotate: rotation }] }}>
          <GlowingStar size={36} color={starColor} glowColor={glowColor} pulseAnim={pulseAnim} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const MenuStack = createNativeStackNavigator();
const HistoryStack = createNativeStackNavigator();

// Font family constants
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extraBold: 'Inter_800ExtraBold',
};

// Menu tab stack
function MenuStackNavigator() {
  const { colors } = useTheme();

  return (
    <MenuStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <MenuStack.Screen name="MenuHome" component={MenuScreen} />
    </MenuStack.Navigator>
  );
}

// History tab stack (Transactions + Detail)
function HistoryStackNavigator() {
  const { colors } = useTheme();

  return (
    <HistoryStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <HistoryStack.Screen name="TransactionsList" component={TransactionsScreen} />
      <HistoryStack.Screen name="TransactionDetail" component={TransactionDetailScreen} />
    </HistoryStack.Navigator>
  );
}

// Custom Tab Bar Icon - Clean iOS style with dot indicator and optional badge
function TabIcon({
  route,
  focused,
  color,
  badge,
}: {
  route: string;
  focused: boolean;
  color: string;
  badge?: number;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const dotOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: focused ? 1.05 : 1,
        tension: 300,
        friction: 20,
        useNativeDriver: true,
      }),
      Animated.timing(dotOpacity, {
        toValue: focused ? 1 : 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [focused, scaleAnim, dotOpacity]);

  let iconName: keyof typeof Ionicons.glyphMap;

  switch (route) {
    case 'Menu':
      iconName = focused ? 'grid' : 'grid-outline';
      break;
    case 'History':
      iconName = focused ? 'receipt' : 'receipt-outline';
      break;
    case 'Events':
      iconName = focused ? 'scan' : 'scan-outline';
      break;
    case 'Preorders':
      iconName = focused ? 'clipboard' : 'clipboard-outline';
      break;
    case 'Settings':
      iconName = focused ? 'settings' : 'settings-outline';
      break;
    default:
      iconName = 'ellipse';
  }

  return (
    <Animated.View
      style={[
        styles.tabIconWrapper,
        { transform: [{ scale: scaleAnim }] },
      ]}
    >
      <View>
        <Ionicons name={iconName} size={26} color={color} />
        {typeof badge === 'number' && badge > 0 ? (
          <View style={styles.tabBadge}>
            <Text style={styles.tabBadgeText}>
              {badge > 99 ? '99+' : String(badge)}
            </Text>
          </View>
        ) : null}
      </View>
      <Animated.View
        style={[
          styles.tabDot,
          { opacity: dotOpacity, backgroundColor: color },
        ]}
      />
    </Animated.View>
  );
}

// Main tab navigator wrapper - includes onboarding modal
function TabNavigatorWithOnboarding() {
  return (
    <View style={{ flex: 1 }}>
      {/* Prefetch data for Settings, Menu, and Transactions on app load */}
      <DataPrefetcher />
      {/* Tap to Pay Onboarding Modal - Apple TTPOi 3.2, 3.3, 3.5 */}
      {/* Rendered here so it has access to the correct navigation context */}
      <TapToPayOnboardingWrapper />
      <TabNavigator />
    </View>
  );
}

// Main tab navigator - Clean iOS style
function TabNavigator() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { subscription } = useAuth();
  const { counts: preorderCounts } = usePreorders();
  const { selectedCatalog } = useCatalog();

  // Only show Events tab for Pro/Enterprise users
  const isPro = subscription?.tier === 'pro' || subscription?.tier === 'enterprise';

  // Only show Preorders tab for Pro/Enterprise users with preorders enabled
  const showPreordersTab = isPro && selectedCatalog?.preorderEnabled === true;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: isDark ? '#111827' : '#ffffff',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
          height: 60 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarIcon: ({ focused, color }) => (
          <TabIcon
            route={route.name}
            focused={focused}
            color={color}
            badge={route.name === 'Preorders' && preorderCounts?.total ? preorderCounts.total : undefined}
          />
        ),
      })}
    >
      <Tab.Screen
        name="Menu"
        component={MenuStackNavigator}
        options={{ tabBarLabel: 'Menu' }}
      />
      {showPreordersTab && (
        <Tab.Screen
          name="Preorders"
          component={PreordersScreen}
          options={{ tabBarLabel: 'Orders' }}
        />
      )}
      <Tab.Screen
        name="History"
        component={HistoryStackNavigator}
        options={{ tabBarLabel: 'History' }}
      />
      <Tab.Screen
        name="Events"
        component={EventsScannerScreen}
        options={{ tabBarLabel: 'Events' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarLabel: 'Settings' }}
      />
    </Tab.Navigator>
  );
}

// Wrapper component for onboarding modals (needs to be inside NavigationContainer)
// Flow: Stripe Connect setup FIRST, then Tap to Pay education (which now includes Enable step)
function TapToPayOnboardingWrapper() {
  const navigation = useNavigation<any>();
  const { user, connectStatus } = useAuth();
  const { deviceId } = useDevice();
  const { isConnected: isTerminalConnected } = useTerminal();

  // Track if user has completed onboarding this session
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  // Track previous chargesEnabled to detect when Connect is newly set up
  const prevChargesEnabledRef = useRef(connectStatus?.chargesEnabled ?? false);

  // Determine if Connect is set up
  const isConnectSetUp = connectStatus?.chargesEnabled === true;

  // Check if this device has already completed Tap to Pay setup (stored in DB)
  const deviceAlreadyRegistered = !!(
    deviceId &&
    user?.tapToPayDeviceIds &&
    user.tapToPayDeviceIds.includes(deviceId)
  );

  // When chargesEnabled changes from false to true (user just completed Connect setup)
  // and device hasn't done TTP education yet, reset the session flag so education triggers
  useEffect(() => {
    const wasEnabled = prevChargesEnabledRef.current;
    const isEnabled = connectStatus?.chargesEnabled === true;
    prevChargesEnabledRef.current = isEnabled;

    if (!wasEnabled && isEnabled && !deviceAlreadyRegistered && !isTerminalConnected) {
      setHasCompletedOnboarding(false);
    }
  }, [connectStatus?.chargesEnabled, deviceAlreadyRegistered, isTerminalConnected]);

  // Show education if: device not registered AND terminal not connected AND not completed this session
  const needsEducation = !hasCompletedOnboarding && !deviceAlreadyRegistered && !isTerminalConnected;

  // Show Setup Payments modal if Connect is NOT set up (takes priority)
  const showSetupPaymentsModal = needsEducation && !isConnectSetUp;

  // Navigate directly to education screen if Connect IS set up
  const shouldNavigateToEducation = needsEducation && isConnectSetUp;

  // Handle Setup Payments modal - user clicked "Continue"
  const handleSetupPayments = useCallback(() => {
    // Mark as complete for this session only (to hide the modal)
    // Don't mark education as seen yet - that happens when user finishes TapToPayEducation
    setHasCompletedOnboarding(true);

    // Navigate to Stripe Connect onboarding after a brief delay
    // This ensures the modal dismisses cleanly before navigation
    // returnTo: 'education' will take them to Tap to Pay education after
    requestAnimationFrame(() => {
      navigation.navigate('StripeOnboarding', { returnTo: 'education' });
    });
  }, [navigation]);

  // Navigate to education screen when Connect is already set up
  useEffect(() => {
    if (shouldNavigateToEducation) {
      // Mark as complete for this session only (to prevent re-triggering)
      // Don't mark education as seen yet - that happens when user finishes TapToPayEducation
      setHasCompletedOnboarding(true);
      navigation.navigate('TapToPayEducation');
    }
  }, [shouldNavigateToEducation, navigation]);

  // Handle skip — dismiss modal and go straight to the app
  const handleSkipPayments = useCallback(() => {
    setHasCompletedOnboarding(true);
  }, []);

  // Show Setup Payments modal if Connect isn't set up
  if (showSetupPaymentsModal) {
    return (
      <SetupPaymentsModal
        visible={true}
        onSetup={handleSetupPayments}
        onSkip={handleSkipPayments}
      />
    );
  }

  // No modal needed - either already completed or navigated to education
  return null;
}

// Main authenticated navigator
function AuthenticatedNavigator() {
  const { colors, isDark } = useTheme();
  const { isLoading: catalogLoading } = useCatalog();
  const { connectLoading } = useAuth();

  // Wait for all loading states to complete before showing content
  const isLoading = catalogLoading || connectLoading;

  if (isLoading) {
    return <LoadingScreen colors={colors} isDark={isDark} />;
  }

  return (
    <StripeTerminalContextProvider>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {/* MainTabs includes TapToPayOnboardingWrapper for correct navigation context */}
        <Stack.Screen name="MainTabs" component={TabNavigatorWithOnboarding} />
      <Stack.Screen
        name="CatalogSelect"
        component={CatalogSelectScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="TapToPaySettings"
        component={TapToPaySettingsScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="TapToPayEducation"
        component={TapToPayEducationScreen}
        options={{ presentation: 'fullScreenModal', headerShown: false }}
      />
      <Stack.Screen
        name="ReaderManagement"
        component={ReaderManagementScreen}
        options={{ presentation: 'card' }}
      />
      <Stack.Screen
        name="Upgrade"
        component={UpgradeScreen}
        options={{ presentation: 'card', headerShown: false }}
      />
      <Stack.Screen
        name="StripeOnboarding"
        component={StripeOnboardingScreen}
        options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
      />

      {/* Payment flow modals */}
      <Stack.Screen
        name="Checkout"
        component={CheckoutScreen}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="PaymentProcessing"
        component={PaymentProcessingScreen}
        options={{
          presentation: 'fullScreenModal',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="PaymentResult"
        component={PaymentResultScreen}
        options={{
          presentation: 'fullScreenModal',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="CashPayment"
        component={CashPaymentScreen}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="SplitPayment"
        component={SplitPaymentScreen}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />

      {/* Preorder screens */}
      <Stack.Screen
        name="Preorders"
        component={PreordersScreen}
        options={{
          presentation: 'card',
        }}
      />
      <Stack.Screen
        name="PreorderDetail"
        component={PreorderDetailScreen}
        options={{
          presentation: 'card',
        }}
      />
    </Stack.Navigator>
    </StripeTerminalContextProvider>
  );
}

// App navigator with auth check
function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const { colors, isDark } = useTheme();

  if (isLoading) {
    return <LoadingScreen colors={colors} isDark={isDark} />;
  }

  return (
    <NavigationContainer
      theme={{
        dark: isDark,
        colors: {
          primary: colors.primary,
          background: colors.background,
          card: colors.card,
          text: colors.text,
          border: colors.border,
          notification: colors.primary,
        },
        fonts: {
          regular: { fontFamily: fonts.regular, fontWeight: '400' },
          medium: { fontFamily: fonts.medium, fontWeight: '500' },
          bold: { fontFamily: fonts.bold, fontWeight: '700' },
          heavy: { fontFamily: fonts.extraBold, fontWeight: '800' },
        },
      }}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {isAuthenticated ? (
          <Stack.Screen name="Authenticated" component={AuthenticatedNavigator} />
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="SignUp" component={SignUpScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// Root component with all providers
export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    onLayoutRootView();
  }, [onLayoutRootView]);

  // Inject CSS to fix Chrome autofill background on web
  useEffect(() => {
    if (Platform.OS === 'web') {
      const style = document.createElement('style');
      style.textContent = `
        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 30px rgba(31, 41, 55, 0.5) inset !important;
          -webkit-text-fill-color: #ffffff !important;
          caret-color: #ffffff !important;
          transition: background-color 5000s ease-in-out 0s;
        }
      `;
      document.head.appendChild(style);
      return () => {
        document.head.removeChild(style);
      };
    }
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <ErrorBoundary>
        <StripeProvider
          publishableKey={config.stripePublishableKey}
          merchantIdentifier="merchant.com.rowie"
        >
          <QueryProvider>
            <SafeAreaProvider>
              <ThemeProvider>
                <AuthProvider>
                  <SocketProvider>
                    <SocketEventHandlers />
                    <DeviceProvider>
                      <CatalogProvider>
                        <PreordersProvider>
                          <CartProvider>
                            <NetworkStatus />
                            <AppNavigator />
                          </CartProvider>
                        </PreordersProvider>
                      </CatalogProvider>
                    </DeviceProvider>
                  </SocketProvider>
                </AuthProvider>
              </ThemeProvider>
            </SafeAreaProvider>
          </QueryProvider>
        </StripeProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  loadingScreen: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  loadingContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    zIndex: 10,
  },
  tabIconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
  },
  tabDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 4,
  },
  tabBadge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
