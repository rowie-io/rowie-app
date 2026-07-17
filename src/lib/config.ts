// App configuration - reads from environment variables

export const config = {
  // API
  apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://api.rowie.eu',

  // WebSocket
  wsUrl: process.env.EXPO_PUBLIC_WS_URL || 'wss://api.rowie.eu',

  // Website
  websiteUrl: process.env.EXPO_PUBLIC_WEBSITE_URL || 'https://rowie.eu',

  // Vendor Dashboard
  vendorDashboardUrl: process.env.EXPO_PUBLIC_VENDOR_DASHBOARD_URL || 'https://portal.rowie.eu',

  // Support
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'support@rowie.eu',

  // Stripe
  stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',

  // Environment
  isDev: __DEV__,
  isProd: !__DEV__,
} as const;
