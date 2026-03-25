import { apiClient } from './client';

export type PreorderStatus = 'pending' | 'preparing' | 'ready' | 'picked_up' | 'cancelled';
export type PreorderPaymentType = 'pay_now' | 'pay_at_pickup';

export interface PreorderItem {
  id: string;
  name: string;
  unitPrice: number; // in dollars (DECIMAL)
  quantity: number;
  notes: string | null;
}

export interface Preorder {
  id: string;
  organizationId: string;
  orderNumber: string;
  dailyNumber: number;
  catalogId: string;
  catalogName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  paymentType: PreorderPaymentType;
  subtotal: number; // in dollars (DECIMAL)
  taxAmount: number; // in dollars (DECIMAL)
  tipAmount: number; // in dollars (DECIMAL)
  totalAmount: number; // in dollars (DECIMAL)
  status: PreorderStatus;
  estimatedReadyAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  orderNotes: string | null;
  stripePaymentIntentId: string | null;
  items: PreorderItem[];
  createdAt: string;
  updatedAt: string;
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
   * List preorders for the organization
   */
  list: (params?: PreordersListParams) => {
    const searchParams = new URLSearchParams();
    if (params?.status) {
      if (Array.isArray(params.status)) {
        params.status.forEach(s => searchParams.append('status', s));
      } else {
        searchParams.append('status', params.status);
      }
    }
    if (params?.catalogId) searchParams.append('catalogId', params.catalogId);
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());

    const query = searchParams.toString();
    return apiClient.get<PreordersListResponse>(`/preorders${query ? `?${query}` : ''}`);
  },

  /**
   * Get a single preorder by ID
   */
  get: async (id: string): Promise<Preorder> => {
    const response = await apiClient.get<{ preorder: Preorder }>(`/preorders/${id}`);
    return response.preorder;
  },

  /**
   * Update preorder status
   */
  updateStatus: async (id: string, status: PreorderStatus, estimatedReadyAt?: string): Promise<Preorder> => {
    const response = await apiClient.patch<{ preorder: Preorder }>(`/preorders/${id}/status`, {
      status,
      ...(estimatedReadyAt && { estimatedReadyAt }),
    });
    return response.preorder;
  },

  /**
   * Complete a preorder pickup
   * For pay_at_pickup orders, pass the paymentIntentId from Tap to Pay
   */
  complete: async (id: string, paymentIntentId?: string): Promise<Preorder> => {
    const response = await apiClient.post<{ preorder: Preorder }>(`/preorders/${id}/complete`, {
      ...(paymentIntentId && { stripePaymentIntentId: paymentIntentId }),
    });
    return response.preorder;
  },

  /**
   * Cancel a preorder
   * Will refund if already paid
   */
  cancel: (id: string, reason?: string) =>
    apiClient.post<{ success: boolean; refunded?: boolean }>(`/preorders/${id}/cancel`, {
      ...(reason && { reason }),
    }),

  /**
   * Get preorder stats for dashboard
   */
  getStats: (catalogId?: string) => {
    const query = catalogId ? `?catalogId=${catalogId}` : '';
    return apiClient.get<PreorderStatsResponse>(`/preorders/stats${query}`);
  },
};
