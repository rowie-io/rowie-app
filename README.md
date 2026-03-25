# Rowie - Mobile App

React Native mobile point-of-sale application for mobile bars, food trucks, and event vendors.

## Tech Stack

- **Framework**: React Native with Expo SDK 54
- **Language**: TypeScript
- **Navigation**: React Navigation v7
- **State**: React Context + TanStack Query v5
- **Payments**: Stripe Terminal (Tap to Pay)
- **Styling**: React Native StyleSheet (dark theme)

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI: `npm install -g expo-cli`
- EAS CLI: `npm install -g eas-cli`

### Installation

```bash
npm install
```

### Development

```bash
# Start Expo dev server
npm run dev

# Run on Android
npm run android

# Run on iOS
npm run ios
```

## Building for Production

### Android (Google Play)

Google Play requires an **AAB (Android App Bundle)** format.

```bash
# Login to Expo
eas login

# Build for production (AAB for Google Play)
eas build --platform android --profile production
```

### Android APK (Testing/Sideloading)

```bash
# Build APK for testing
eas build --platform android --profile preview
```

### iOS (App Store)

```bash
# Build for App Store
eas build --platform ios --profile production
```

### Local Builds

If you prefer to build locally without Expo's cloud:

```bash
# Generate native projects
npx expo prebuild --platform android

# Build APK locally (requires Android Studio)
cd android
./gradlew assembleRelease

# Build AAB locally
./gradlew bundleRelease
```

Output will be in `android/app/build/outputs/`.

## EAS Build Configuration

The `eas.json` file controls build profiles:

```json
{
  "build": {
    "production": {
      "android": {
        "buildType": "app-bundle"
      }
    },
    "preview": {
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

## Environment Variables

Create a `.env` file:

```bash
EXPO_PUBLIC_API_URL=https://api.rowie.io
```

## Project Structure

```
/src
  /context      # Auth, Cart, Theme contexts
  /screens      # App screens
  /components   # Reusable components
  /lib
    /api        # API client and services
  /hooks        # Custom React hooks
```

## Related Repositories

- [rowie-api](../rowie-api) - Backend API (Hono, PostgreSQL)
- [rowie-vendor](../rowie-vendor) - Vendor dashboard (Next.js)
- [rowie-marketing](../rowie-marketing) - Marketing website (Next.js)



ANDROID LOGS
 & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat *:S ReactNative:V ReactNativeJS:V
 