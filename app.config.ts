import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const ENV = process.env.EXPO_PUBLIC_APP_ENV || 'dev';

  return {
    ...config,
    name: ENV === 'prod' ? 'Rowie' : `Rowie (${ENV})`,
    slug: 'rowie',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/logo-dark.png',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    scheme: 'rowie',
    splash: {
      image: './assets/rowie-wordmark.png',
      resizeMode: 'contain',
      backgroundColor: '#000000',
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.rowie.app',
      icon: './assets/logo-dark.png',
      entitlements: {
        'com.apple.developer.proximity-reader.payment.acceptance': true,
      },
      infoPlist: {
        NFCReaderUsageDescription: 'This app uses NFC to accept contactless payments via Tap to Pay',
        NSCameraUsageDescription: 'This app uses the camera to scan payment cards and QR codes',
        NSFaceIDUsageDescription: 'This app uses Face ID to securely sign in to your account',
        NSPhotoLibraryUsageDescription: 'This app accesses your photo library so you can upload a profile picture or add images to your products. For example, you can select a photo of a menu item to display in your catalog.',
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.rowie.app',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon-foreground.png',
        monochromeImage: './assets/adaptive-icon-foreground.png',
        backgroundColor: '#000000',
      },
      edgeToEdgeEnabled: true,
      permissions: [
        'android.permission.NFC',
        'android.permission.ACCESS_FINE_LOCATION',
      ],
    },
    web: {
      bundler: 'metro',
      backgroundColor: '#000000',
      themeColor: '#000000',
    },
    plugins: [
      'expo-font',
      './plugins/withProximityReaderDiscovery',
      [
        '@stripe/stripe-terminal-react-native',
        {
          bluetoothBackgroundMode: true,
          locationWhenInUsePermission: 'This app uses your location for payment processing',
          bluetoothPeripheralPermission: 'This app uses Bluetooth to connect to card readers',
          bluetoothAlwaysUsagePermission: 'This app uses Bluetooth to connect to card readers',
          appDelegate: true,
          tapToPayCheck: true,
        },
      ],
      [
        'expo-alternate-app-icons',
        {
          icons: {
            dark: './assets/logo-dark.png',
            light: './assets/logo-light.png',
          },
        },
      ],
      [
        'expo-build-properties',
        {
          ios: {
            deploymentTarget: '16.4',
          },
          android: {
            minSdkVersion: 26,
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            extraProguardRules: `
              # Jackson databind - java.beans not available on Android
              -dontwarn java.beans.ConstructorProperties
              -dontwarn java.beans.Transient

              # SLF4J - implementation classes loaded dynamically
              -dontwarn org.slf4j.impl.StaticLoggerBinder
              -dontwarn org.slf4j.impl.StaticMDCBinder
            `,
          },
        },
      ],
      [
        '@stripe/stripe-react-native',
        {
          merchantIdentifier: 'merchant.com.rowie',
          enableGooglePay: false,
          enableApplePay: false,
        },
      ],
    ],
    extra: {
      eas: {
        projectId: '537e258c-86b4-4674-be82-bf36aa27e33e',
      },
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      env: ENV,
    },
  };
};
