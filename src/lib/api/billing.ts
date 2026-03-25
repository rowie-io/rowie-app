import { apiClient } from './client';

export type SubscriptionPlatform = 'stripe' | 'apple' | 'google' | 'manual';

export interface SubscriptionPlan {
  name: string;
  price: number; // in cents
  currency: string;
  interval: 'month' | 'year';
  description?: string;
}

export interface SubscriptionInfo {
  tier: 'starter' | 'pro' | 'enterprise' | 'none';
  status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'none';
  platform: SubscriptionPlatform;
  current_plan?: SubscriptionPlan | null;
  current_period_end?: string | null;
  cancel_at?: string | null;
  canceled_at?: string | null;
  trial_end?: string | null;
  manage_subscription_url?: string | null; // For Stripe subscriptions
}

export const billingService = {
  /**
   * Get subscription information for the current user's organization
   */
  getSubscriptionInfo: async (): Promise<SubscriptionInfo> => {
    return apiClient.get<SubscriptionInfo>('/billing/subscription-info');
  },

  /**
   * Validate an Apple App Store receipt and activate/update subscription
   */
  validateAppleReceipt: async (receiptData: string): Promise<{ success: boolean; subscription?: SubscriptionInfo }> => {
    return apiClient.post<{ success: boolean; subscription?: SubscriptionInfo }>('/billing/validate-apple-receipt', {
      receipt_data: receiptData,
    });
  },

  /**
   * Validate a Google Play purchase and activate/update subscription
   */
  validateGooglePurchase: async (
    purchaseToken: string,
    productId: string
  ): Promise<{ success: boolean; subscription?: SubscriptionInfo }> => {
    return apiClient.post<{ success: boolean; subscription?: SubscriptionInfo }>('/billing/validate-google-purchase', {
      purchase_token: purchaseToken,
      product_id: productId,
    });
  },
};
