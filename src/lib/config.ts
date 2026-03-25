// App configuration - reads from environment variables

export const config = {
  // API
  apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://api.rowie.io',

  // WebSocket
  wsUrl: process.env.EXPO_PUBLIC_WS_URL || 'wss://api.rowie.io',

  // Website
  websiteUrl: process.env.EXPO_PUBLIC_WEBSITE_URL || 'https://rowie.io',

  // Vendor Dashboard
  vendorDashboardUrl: process.env.EXPO_PUBLIC_VENDOR_DASHBOARD_URL || 'https://portal.rowie.io',

  // Stripe
  stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',

  // Environment
  isDev: __DEV__,
  isProd: !__DEV__,
} as const;
