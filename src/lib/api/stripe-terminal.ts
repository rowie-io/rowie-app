import { apiClient } from './client';

export interface ConnectionToken {
  secret: string;
}

export interface TerminalLocation {
  locationId: string;
  displayName: string;
}

export interface CreatePaymentIntentParams {
  amount: number; // In dollars (will be converted to cents by API)
  currency?: string;
  description?: string;
  metadata?: Record<string, string>;
  receiptEmail?: string;
  captureMethod?: 'automatic' | 'manual'; // For manual card, use 'automatic'
  paymentMethodType?: 'card_present' | 'card'; // 'card' for manual entry, 'card_present' for tap to pay
  orderId?: string; // For split payments
  isQuickCharge?: boolean; // Whether this is a quick charge (no order)
}

export interface PaymentIntent {
  id: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: string;
  stripeAccountId: string;
}

export interface TerminalReader {
  id: string;
  label: string | null;
  deviceType: string;
  status: string | null;
  ipAddress: string | null;
  locationId: string | null;
  serialNumber: string | null;
}

export const stripeTerminalApi = {
  /**
   * Get or create a Terminal location for Tap to Pay
   * Required before connecting to local mobile reader
   */
  getLocation: () =>
    apiClient.get<TerminalLocation>('/stripe/terminal/location'),

  /**
   * Get a connection token for Stripe Terminal SDK
   */
  getConnectionToken: () =>
    apiClient.post<ConnectionToken>('/stripe/terminal/connection-token', {}),

  /**
   * Create a payment intent for terminal payment
   */
  createPaymentIntent: (params: CreatePaymentIntentParams) =>
    apiClient.post<PaymentIntent>('/stripe/terminal/payment-intent', params),

  /**
   * Cancel a payment intent
   */
  cancelPaymentIntent: (paymentIntentId: string) =>
    apiClient.post<{ success: boolean }>(`/stripe/terminal/payment-intent/${paymentIntentId}/cancel`, {}),

  /**
   * Send receipt email for a completed payment
   */
  sendReceipt: (paymentIntentId: string, email: string) =>
    apiClient.post<{ success: boolean; receiptUrl: string | null }>(
      `/stripe/terminal/payment-intent/${paymentIntentId}/send-receipt`,
      { email }
    ),

  /**
   * Simulate a terminal payment for testing (test mode only)
   * Creates a real test payment in Stripe without requiring NFC/card tap
   */
  simulatePayment: (paymentIntentId: string) =>
    apiClient.post<{
      id: string;
      status: string;
      amount: number;
      receiptUrl: string | null;
    }>(`/stripe/terminal/payment-intent/${paymentIntentId}/simulate`, {}),

  // ── Physical Terminal Reader Management ──

  /**
   * List all registered terminal readers for the organization
   */
  listReaders: () =>
    apiClient.get<{ readers: TerminalReader[] }>('/stripe/terminal/readers'),

  /**
   * Register a new physical terminal reader
   */
  registerReader: (data: { registrationCode: string; label?: string }) =>
    apiClient.post<{ id: string; label: string | null; deviceType: string; status: string | null; locationId: string | null }>(
      '/stripe/terminal/readers',
      data
    ),

  /**
   * Delete/deregister a terminal reader
   */
  deleteReader: (readerId: string) =>
    apiClient.delete<{ deleted: boolean; id: string }>(`/stripe/terminal/readers/${readerId}`),

  /**
   * Send an existing PaymentIntent to a smart reader for server-driven collection
   */
  processPayment: (readerId: string, data: { paymentIntentId: string }) =>
    apiClient.post<{ paymentIntentId: string; readerId: string; readerLabel: string | null; actionStatus: string }>(
      `/stripe/terminal/readers/${readerId}/process-payment`,
      data
    ),

  /**
   * Cancel a pending action on a reader
   */
  cancelReaderAction: (readerId: string) =>
    apiClient.post<{ readerId: string; status: string }>(
      `/stripe/terminal/readers/${readerId}/cancel-action`,
      {}
    ),
};
