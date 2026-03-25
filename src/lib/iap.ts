/**
 * In-App Purchase Service
 * Handles subscriptions for iOS (StoreKit) and Android (Google Play Billing)
 * Uses react-native-iap for cross-platform support
 *
 * Note: IAP is not available on web - this module provides a stub for web builds
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from './config';
import logger from './logger';

// Storage key for access token (must match auth.ts)
const ACCESS_TOKEN_KEY = 'accessToken';

// Conditionally import react-native-iap only on native platforms
// v14 uses Nitro Modules with OpenIAP API
let RNIap: any = null;
let iapLoadError: string | null = null;

if (Platform.OS !== 'web') {
  try {
    RNIap = require('react-native-iap');
    logger.log('[IAP] Module loaded, available functions:', Object.keys(RNIap || {}));
  } catch (error: any) {
    iapLoadError = `Failed to load react-native-iap: ${error?.message || error}`;
    logger.warn('[IAP]', iapLoadError);
  }
}

// Product IDs - must match App Store Connect and Google Play Console
export const SUBSCRIPTION_SKUS = Platform.select({
  ios: ['rowieproplan'],
  android: ['rowieproplan'],
  default: [],
});

// Subscription product details
export interface SubscriptionProduct {
  productId: string;
  title: string;
  description: string;
  price: string;
  localizedPrice: string;
  currency: string;
  introductoryPrice?: string;
  introductoryPricePaymentMode?: string;
  introductoryPriceNumberOfPeriods?: number;
  introductoryPriceSubscriptionPeriod?: string;
  subscriptionPeriodNumberIOS?: string;
  subscriptionPeriodUnitIOS?: string;
  freeTrialPeriodAndroid?: string;
}

// Purchase result
export interface PurchaseResult {
  success: boolean;
  transactionId?: string;
  productId?: string;
  receipt?: string;
  error?: string;
}

// Subscription status
export interface SubscriptionStatus {
  isActive: boolean;
  productId?: string;
  expiresAt?: Date;
  isTrialPeriod?: boolean;
  autoRenewing?: boolean;
}

class IAPService {
  private isInitialized = false;
  private purchaseUpdateSubscription: any = null;
  private purchaseErrorSubscription: any = null;
  private onPurchaseComplete: ((result: PurchaseResult) => void) | null = null;

  /**
   * Check if IAP is available on this platform
   */
  isAvailable(): boolean {
    return Platform.OS !== 'web' && RNIap !== null;
  }

  /**
   * Get error message if IAP is not available
   */
  getUnavailableReason(): string | null {
    if (Platform.OS === 'web') {
      return 'In-app purchases are not available on web';
    }
    return iapLoadError;
  }

  /**
   * Initialize the IAP connection
   * Must be called before any other IAP methods
   */
  async initialize(): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.log('[IAP] Not available:', this.getUnavailableReason());
      return false;
    }

    if (this.isInitialized) {
      logger.log('[IAP] Already initialized');
      return true;
    }

    try {
      logger.log('[IAP] Initializing connection...');
      const result = await RNIap.initConnection();
      logger.log('[IAP] Connection result:', result);

      // Set up purchase listeners
      this.setupPurchaseListeners();

      this.isInitialized = true;
      logger.log('[IAP] Initialized successfully');
      return true;
    } catch (error: any) {
      logger.error('[IAP] Failed to initialize:', error);
      return false;
    }
  }

  /**
   * Set up listeners for purchase events
   */
  private setupPurchaseListeners() {
    if (!RNIap) return;

    // Listen for successful purchases
    this.purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(
      async (purchase: any) => {
        // v14 may use 'id' instead of 'productId'
        const productId = purchase.productId || purchase.id;
        const transactionId = purchase.transactionId || purchase.id;
        logger.log('[IAP] Purchase updated:', productId);
        logger.log('[IAP] Purchase object:', JSON.stringify(purchase));

        try {
          // Validate receipt with backend
          const validation = await this.validateReceipt(purchase);

          if (validation.valid) {
            // Finish the transaction
            await RNIap.finishTransaction({ purchase, isConsumable: false });
            logger.log('[IAP] Transaction finished successfully');

            if (this.onPurchaseComplete) {
              this.onPurchaseComplete({
                success: true,
                transactionId,
                productId,
                receipt: Platform.OS === 'ios'
                  ? purchase.transactionReceipt
                  : purchase.purchaseToken,
              });
            }
          } else {
            logger.error('[IAP] Receipt validation failed');
            if (this.onPurchaseComplete) {
              this.onPurchaseComplete({
                success: false,
                error: 'Receipt validation failed',
              });
            }
          }
        } catch (error: any) {
          logger.error('[IAP] Error processing purchase:', error);
          if (this.onPurchaseComplete) {
            this.onPurchaseComplete({
              success: false,
              error: error.message || 'Failed to process purchase',
            });
          }
        }
      }
    );

    // Listen for purchase errors
    this.purchaseErrorSubscription = RNIap.purchaseErrorListener(
      (error: any) => {
        logger.error('[IAP] Purchase error:', error);

        if (this.onPurchaseComplete) {
          // User cancelled is not a real error
          if (error.code === 'E_USER_CANCELLED') {
            this.onPurchaseComplete({
              success: false,
              error: 'Purchase cancelled',
            });
          } else {
            this.onPurchaseComplete({
              success: false,
              error: error.message || 'Purchase failed',
            });
          }
        }
      }
    );
  }

  /**
   * Clean up IAP connection
   */
  async cleanup(): Promise<void> {
    if (!this.isAvailable()) return;

    logger.log('[IAP] Cleaning up...');

    if (this.purchaseUpdateSubscription) {
      this.purchaseUpdateSubscription.remove();
      this.purchaseUpdateSubscription = null;
    }

    if (this.purchaseErrorSubscription) {
      this.purchaseErrorSubscription.remove();
      this.purchaseErrorSubscription = null;
    }

    try {
      await RNIap.endConnection();
      this.isInitialized = false;
      logger.log('[IAP] Cleanup complete');
    } catch (error) {
      logger.error('[IAP] Error during cleanup:', error);
    }
  }

  /**
   * Get available subscription products
   */
  async getProducts(): Promise<SubscriptionProduct[]> {
    if (!this.isAvailable()) {
      logger.log('[IAP] Not available, returning empty products');
      return [];
    }

    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      logger.log('[IAP] Fetching products:', SUBSCRIPTION_SKUS);
      // v14 API: use fetchProducts with type: 'subs' for subscriptions
      const subscriptions = await RNIap.fetchProducts({ skus: SUBSCRIPTION_SKUS!, type: 'subs' });
      logger.log('[IAP] Products fetched:', subscriptions.length, subscriptions);

      // v14 API uses different property names:
      // - 'id' instead of 'productId'
      // - 'displayPrice' instead of 'localizedPrice'
      // - 'displayName' instead of 'title' (on Android)
      return subscriptions.map((sub: any) => ({
        productId: sub.id || sub.productId,
        title: sub.title || sub.displayName,
        description: sub.description,
        price: sub.price,
        localizedPrice: sub.displayPrice || sub.localizedPrice,
        currency: sub.currency,
        introductoryPrice: sub.introductoryPrice,
        introductoryPricePaymentMode: sub.introductoryPricePaymentModeIOS,
        introductoryPriceNumberOfPeriods: sub.introductoryPriceNumberOfPeriodsIOS,
        introductoryPriceSubscriptionPeriod: sub.introductoryPriceSubscriptionPeriodIOS,
        subscriptionPeriodNumberIOS: sub.subscriptionPeriodNumberIOS,
        subscriptionPeriodUnitIOS: sub.subscriptionPeriodUnitIOS,
        freeTrialPeriodAndroid: sub.freeTrialPeriodAndroid,
      }));
    } catch (error: any) {
      logger.error('[IAP] Error fetching products:', error);
      return [];
    }
  }

  /**
   * Purchase a subscription
   */
  async purchaseSubscription(
    productId: string,
    onComplete: (result: PurchaseResult) => void
  ): Promise<void> {
    if (!this.isAvailable()) {
      onComplete({
        success: false,
        error: this.getUnavailableReason() || 'IAP not available',
      });
      return;
    }

    if (!this.isInitialized) {
      await this.initialize();
    }

    this.onPurchaseComplete = onComplete;

    try {
      logger.log('[IAP] Requesting subscription:', productId);

      if (Platform.OS === 'ios') {
        // iOS: use requestPurchase with request.apple wrapper
        logger.log('[IAP] iOS: requesting subscription purchase');
        await RNIap.requestPurchase({
          request: {
            apple: {
              sku: productId,
            },
          },
          type: 'subs',
        });
      } else {
        // Android requires offer token for subscriptions
        // Fetch products to get offer details
        const subscriptions = await RNIap.fetchProducts({ skus: [productId], type: 'subs' });
        logger.log('[IAP] Android subscriptions fetched:', subscriptions.length);

        if (subscriptions.length > 0) {
          const subscription = subscriptions[0] as any;
          // Get offer details from subscriptionOfferDetailsAndroid
          const offerDetails = subscription.subscriptionOfferDetailsAndroid;

          // Build subscription offers array
          const subscriptionOffers = offerDetails?.map((offer: any) => ({
            sku: productId,
            offerToken: offer.offerToken,
          })) || [];

          logger.log('[IAP] Subscription offers:', JSON.stringify(subscriptionOffers));

          if (subscriptionOffers.length === 0) {
            throw new Error('No offer token available for subscription');
          }

          // Android: use requestPurchase with request.google wrapper and type: 'subs'
          logger.log('[IAP] Android: requesting subscription purchase');
          await RNIap.requestPurchase({
            request: {
              google: {
                skus: [productId],
                subscriptionOffers,
              },
            },
            type: 'subs',
          });
        } else {
          throw new Error('Subscription not found');
        }
      }
    } catch (error: any) {
      logger.error('[IAP] Error purchasing subscription:', error);
      onComplete({
        success: false,
        error: error.message || 'Failed to purchase subscription',
      });
    }
  }

  /**
   * Restore previous purchases
   */
  async restorePurchases(): Promise<SubscriptionStatus> {
    if (!this.isAvailable()) {
      return { isActive: false };
    }

    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      logger.log('[IAP] Restoring purchases...');
      const purchases = await RNIap.getAvailablePurchases();
      logger.log('[IAP] Found purchases:', purchases.length);

      // Find active subscription
      for (const purchase of purchases) {
        // v14 may use 'id' instead of 'productId'
        const productId = purchase.productId || purchase.id;
        if (SUBSCRIPTION_SKUS!.includes(productId)) {
          // Validate with backend
          const validation = await this.validateReceipt(purchase);

          if (validation.valid && validation.isActive) {
            return {
              isActive: true,
              productId,
              expiresAt: validation.expiresAt,
              isTrialPeriod: validation.isTrialPeriod,
              autoRenewing: validation.autoRenewing,
            };
          }
        }
      }

      return { isActive: false };
    } catch (error: any) {
      logger.error('[IAP] Error restoring purchases:', error);
      return { isActive: false };
    }
  }

  /**
   * Validate receipt with backend
   */
  private async validateReceipt(
    purchase: any
  ): Promise<{
    valid: boolean;
    isActive?: boolean;
    expiresAt?: Date;
    isTrialPeriod?: boolean;
    autoRenewing?: boolean;
  }> {
    try {
      // v14 may use different property names
      const productId = purchase.productId || purchase.id;
      const transactionId = purchase.transactionId || purchase.id;
      const receipt = Platform.OS === 'ios'
        ? purchase.transactionReceipt
        : purchase.purchaseToken;

      logger.log('[IAP] Validating receipt for:', productId);

      // Get auth token for authenticated request
      const accessToken = await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
      if (!accessToken) {
        // No auth token - this is likely a signup flow where the user isn't logged in yet.
        // Skip client-side validation and return valid: true so the purchase can proceed.
        // The signup endpoint will validate the receipt when creating the account.
        logger.log('[IAP] No access token - skipping client validation (signup flow)');
        return { valid: true };
      }

      const response = await fetch(`${config.apiUrl}/billing/validate-receipt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          platform: Platform.OS,
          productId,
          receipt,
          transactionId,
        }),
      });

      if (!response.ok) {
        logger.error('[IAP] Receipt validation failed:', response.status);
        return { valid: false };
      }

      const data = await response.json();
      return {
        valid: data.valid,
        isActive: data.isActive,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        isTrialPeriod: data.isTrialPeriod,
        autoRenewing: data.autoRenewing,
      };
    } catch (error) {
      logger.error('[IAP] Error validating receipt:', error);
      return { valid: false };
    }
  }

  /**
   * Check current subscription status
   */
  async checkSubscriptionStatus(): Promise<SubscriptionStatus> {
    try {
      // Get auth token for authenticated request
      const accessToken = await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
      if (!accessToken) {
        logger.log('[IAP] No access token, cannot check subscription status');
        return { isActive: false };
      }

      // Check with backend
      const response = await fetch(`${config.apiUrl}/billing/subscription-info`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const isActive = data.status === 'active' || data.status === 'trialing';
        return {
          isActive,
          productId: data.tier === 'pro' ? 'rowieproplan' : undefined,
          expiresAt: data.current_period_end ? new Date(data.current_period_end) : undefined,
          isTrialPeriod: data.status === 'trialing',
          autoRenewing: !data.cancel_at,
        };
      }

      // Fallback to restore purchases (only on native)
      if (this.isAvailable()) {
        return await this.restorePurchases();
      }

      return { isActive: false };
    } catch (error) {
      logger.error('[IAP] Error checking subscription status:', error);
      return { isActive: false };
    }
  }
}

export const iapService = new IAPService();
