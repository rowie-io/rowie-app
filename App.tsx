import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as SplashScreen from 'expo-splash-screen';

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
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { QueryProvider } from './src/providers/QueryProvider';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { LanguageProvider } from './src/context/LanguageContext';
import { CatalogProvider, useCatalog } from './src/context/CatalogContext';
import { CartProvider } from './src/context/CartContext';
import { DeviceProvider, useDevice } from './src/context/DeviceContext';
import { SocketProvider } from './src/context/SocketContext';
import { SocketEventHandlers } from './src/components/SocketEventHandlers';
import { StripeTerminalContextProvider, useTerminal } from './src/context/StripeTerminalContext';
import { NetworkStatus } from './src/components/NetworkStatus';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { DataPrefetcher } from './src/components/DataPrefetcher';
import { config } from './src/lib/config';
import { FloatingTabBar, FLOATING_TAB_BAR_HEIGHT } from './src/components/ui/FloatingTabBar';

// Auth screens
import { LoginScreen } from './src/screens/LoginScreen';
import { SignUpScreen } from './src/screens/SignUpScreen';
import { ForgotPasswordScreen } from './src/screens/ForgotPasswordScreen';
import { ResetPasswordScreen } from './src/screens/ResetPasswordScreen';

// Main screens
import { CatalogSelectScreen } from './src/screens/CatalogSelectScreen';
import { LocationPickerScreen } from './src/screens/LocationPickerScreen';
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
import { FloorPlanScreen } from './src/screens/FloorPlanScreen';
import { SessionDetailScreen } from './src/screens/SessionDetailScreen';
import { TabsScreen } from './src/screens/TabsScreen';
import { OpenTabScreen } from './src/screens/OpenTabScreen';
import { AddItemsToSessionScreen } from './src/screens/AddItemsToSessionScreen';

// Education screens
import { TapToPayEducationScreen } from './src/screens/TapToPayEducationScreen';

// Reader management
import { ReaderManagementScreen } from './src/screens/ReaderManagementScreen';

// Onboarding components
import { SetupPaymentsModal } from './src/components/SetupPaymentsModal';

// Keep splash screen visible while loading fonts
SplashScreen.preventAutoHideAsync();

function LoadingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#1C1917', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#F59E0B" />
    </View>
  );
}

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const MenuStack = createNativeStackNavigator();
const HistoryStack = createNativeStackNavigator();

// Font family constants
export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semiBold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extraBold: 'PlusJakartaSans_800ExtraBold',
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

// TabIcon removed — now using FloatingTabBar component

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

// Main tab navigator - Floating pill bar
function TabNavigator() {
  const { colors } = useTheme();
  const { subscription } = useAuth();

  // Tabs are a Pro feature but are not tied to QR ordering (unlike the old
  // preorders system). Any Pro vendor can open/close tabs on any catalog.
  const isPro = subscription?.tier === 'pro' || subscription?.tier === 'enterprise';
  const showTabsTab = isPro;

  return (
    <Tab.Navigator
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { paddingBottom: FLOATING_TAB_BAR_HEIGHT },
      }}
    >
      <Tab.Screen
        name="Menu"
        component={MenuStackNavigator}
      />
      {showTabsTab && (
        <Tab.Screen
          name="TabsTab"
          component={TabsScreen}
        />
      )}
      <Tab.Screen
        name="History"
        component={HistoryStackNavigator}
      />
      <Tab.Screen
        name="Events"
        component={EventsScannerScreen}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
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
    setHasCompletedOnboarding(true);
    navigation.navigate('StripeOnboarding', { returnTo: 'education' });
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
    return <LoadingScreen />;
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
        name="LocationPicker"
        component={LocationPickerScreen}
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

      {/* Tables, Sessions & Tabs */}
      <Stack.Screen
        name="FloorPlan"
        component={FloorPlanScreen}
        options={{
          presentation: 'card',
        }}
      />
      <Stack.Screen
        name="SessionDetail"
        component={SessionDetailScreen}
        options={{
          presentation: 'card',
        }}
      />
      <Stack.Screen
        name="Tabs"
        component={TabsScreen}
        options={{
          presentation: 'card',
        }}
      />
      <Stack.Screen
        name="OpenTab"
        component={OpenTabScreen}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="AddItemsToSession"
        component={AddItemsToSessionScreen}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack.Navigator>
    </StripeTerminalContextProvider>
  );
}

// App navigator with auth check
function LanguageBridge({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return (
    <LanguageProvider userLanguage={user?.language} orgLanguage={user?.orgLanguage}>
      {children}
    </LanguageProvider>
  );
}

function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const { colors, isDark } = useTheme();

  if (isLoading) {
    return <LoadingScreen />;
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
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
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
          -webkit-box-shadow: 0 0 0 30px rgba(41, 37, 36, 0.5) inset !important;
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
                  <LanguageBridge>
                    <SocketProvider>
                      <SocketEventHandlers />
                      <DeviceProvider>
                        <CatalogProvider>
                          <CartProvider>
                            <NetworkStatus />
                            <AppNavigator />
                          </CartProvider>
                        </CatalogProvider>
                      </DeviceProvider>
                    </SocketProvider>
                  </LanguageBridge>
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
});
