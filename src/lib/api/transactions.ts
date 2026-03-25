import { apiClient } from './client';

export type SourceType = 'order' | 'preorder' | 'ticket';

export interface PaymentMethod {
  type?: string;       // 'card' | 'card_present' | 'cash' | 'split' | 'tap_to_pay'
  brand: string | null;
  last4: string | null;
}

export interface Refund {
  id: string;
  amount: number;
  status: string;
  reason: string | null;
  created: number;
}

export interface Transaction {
  id: string;
  amount: number;
  amountRefunded: number;
  status: 'succeeded' | 'pending' | 'failed' | 'refunded' | 'partially_refunded' | 'cancelled';
  description: string | null;
  customerName: string | null;
  customerEmail: string | null;
  paymentMethod: PaymentMethod | null;
  created: number; // Unix timestamp
  receiptUrl: string | null;
  sourceType?: SourceType;
  catalogName?: string | null;
  eventName?: string | null;
  tierName?: string | null;
  dailyNumber?: number | null;
  itemCount?: number;
}

export interface OrderPaymentDetail {
  id: string;
  paymentMethod: string;
  amount: number; // in cents
  tipAmount: number;
  status: string;
  cashTendered: number | null;
  cashChange: number | null;
  stripePaymentIntentId: string | null;
  created: number;
}

export interface TransactionDetail extends Transaction {
  refunds: Refund[];
  cashTendered?: number | null; // in cents
  cashChange?: number | null; // in cents
  orderPayments?: OrderPaymentDetail[];
}

export interface TransactionsListParams {
  limit?: number;
  starting_after?: string;
  status?: string;
  catalog_id?: string;
  device_id?: string;
}

export interface TransactionsListResponse {
  data: Transaction[];
  hasMore: boolean;
}

export interface RefundParams {
  amount?: number; // Optional for partial refund (in cents)
}

export const transactionsApi = {
  /**
   * List transactions for the organization
   * Optionally filter by device_id to show only transactions from a specific device
   */
  list: (params?: TransactionsListParams) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.starting_after) searchParams.append('starting_after', params.starting_after);
    if (params?.status) searchParams.append('status', params.status);
    if (params?.catalog_id) searchParams.append('catalog_id', params.catalog_id);
    if (params?.device_id) searchParams.append('device_id', params.device_id);

    const query = searchParams.toString();
    return apiClient.get<TransactionsListResponse>(
      `/stripe/connect/transactions${query ? `?${query}` : ''}`
    );
  },

  /**
   * Get a single transaction with full details
   */
  get: (id: string) =>
    apiClient.get<TransactionDetail>(`/stripe/connect/transactions/${id}`),

  /**
   * Issue a refund for a transaction
   */
  refund: (id: string, params?: RefundParams) =>
    apiClient.post<{ success: boolean }>(`/stripe/connect/transactions/${id}/refund`, params || {}),

  /**
   * Send receipt email for a transaction
   */
  sendReceipt: (id: string, email: string) =>
    apiClient.post<{ success: boolean; message: string }>(`/stripe/connect/transactions/${id}/send-receipt`, { email }),
};
