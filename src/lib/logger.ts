/**
 * Logger utility
 * Logs in __DEV__ mode OR when EXPO_PUBLIC_APP_ENV is 'dev'
 * Disabled in production builds
 */

const isDev = __DEV__ || process.env.EXPO_PUBLIC_APP_ENV === 'dev';

export const logger = {
  log: (...args: unknown[]) => {
    if (isDev) console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    if (isDev) console.error(...args);
  },
  debug: (...args: unknown[]) => {
    if (isDev) console.debug(...args);
  },
};

export default logger;
