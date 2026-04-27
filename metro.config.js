const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Native-only modules that crash Metro's web bundler.
// When bundling for web, resolve them to local stubs instead.
const WEB_SHIMS = {
  '@stripe/stripe-react-native': path.resolve(__dirname, 'src/lib/web-shims/stripe-rn.tsx'),
  '@stripe/stripe-terminal-react-native': path.resolve(__dirname, 'src/lib/web-shims/stripe-terminal.ts'),
  'react-native-iap': path.resolve(__dirname, 'src/lib/web-shims/iap.ts'),
  'react-native-international-phone-number': path.resolve(__dirname, 'src/lib/web-shims/phone-input.tsx'),
  'react-native-draggable-flatlist': path.resolve(__dirname, 'src/lib/web-shims/draggable-flatlist.tsx'),
};

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_SHIMS[moduleName]) {
    return { filePath: WEB_SHIMS[moduleName], type: 'sourceFile' };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
