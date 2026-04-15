/**
 * Backward-compat shim — preorders were replaced by table_sessions.
 *
 * The mobile app's TransactionDetailScreen still uses the legacy "preorder"
 * display shape for historical transactions. This shim proxies the old
 * `preordersApi.get(id)` call to the `/preorders/{id}` compat endpoint on the
 * API, which maps session data into the legacy shape.
 *
 * Do not use in new code — use `sessionsApi` directly.
 */
import { apiClient } from './client';

export type PreorderStatus = 'pending' | 'preparing' | 'ready' | 'picked_up' | 'cancelled';
export type PreorderPaymentType = 'pay_now' | 'pay_at_pickup';

export interface PreorderItem {
  id: string;
  catalogProductId: string;
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  notes: string | null;
}

export interface Preorder {
  id: string;
  organizationId: string;
  catalogId: string;
  catalogName: string | null;
  orderNumber: string;
  dailyNumber: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  paymentType: PreorderPaymentType;
  subtotal: number;
  taxAmount: number;
  tipAmount: number;
  totalAmount: number;
  platformFeeCents: number;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  status: PreorderStatus;
  estimatedReadyAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  pickedUpBy: string | null;
  pickedUpByName: string | null;
  orderNotes: string | null;
  internalNotes: string | null;
  tableIdentifier: string | null;
  createdAt: string;
  updatedAt: string;
  items: PreorderItem[];
}

export interface PreordersListParams {
  status?: PreorderStatus | PreorderStatus[];
  catalogId?: string;
  limit?: number;
  offset?: number;
}

export interface PreordersListResponse {
  preorders: Preorder[];
  total: number;
}

export interface PreorderStatsResponse {
  pending: number;
  preparing: number;
  ready: number;
  today: number;
  todayRevenue: number;
}

export const preordersApi = {
  /**
   * Fetch a single preorder by ID via the /preorders/{id} compat endpoint.
   * The API maps the underlying table_session into the legacy Preorder shape.
   */
  get: async (id: string): Promise<Preorder> => {
    const response = await apiClient.get<{ preorder: Preorder }>(`/preorders/${id}`);
    return response.preorder;
  },
};
