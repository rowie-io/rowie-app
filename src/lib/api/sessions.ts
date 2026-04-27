import { apiClient } from './client';

export type SessionStatus = 'open' | 'settling' | 'settled' | 'cancelled';
export type SessionSource = 'pos' | 'qr_table' | 'qr_menu' | 'hold' | 'tab';
export type ItemStatus = 'pending' | 'sent' | 'preparing' | 'ready' | 'served';

export interface Session {
  id: string;
  organizationId: string;
  catalogId: string;
  catalogName: string | null;
  tableId: string | null;
  tableLabel: string | null;
  tableCode: string | null;
  floorPlanId: string | null;
  sessionNumber: string;
  dailyNumber: number;
  source: SessionSource;
  customerName: string | null;
  customerEmail: string | null;
  holdName: string | null;
  subtotal: number;
  taxAmount: number;
  tipAmount: number;
  totalAmount: number;
  status: SessionStatus;
  openedBy: string | null;
  deviceId: string | null;
  guestCount: number | null;
  orderNotes: string | null;
  orderId: string | null;
  itemCount: number;
  openedAt: string;
  settledAt: string | null;
  createdAt: string;
}

export interface SessionItem {
  id: string;
  sessionId: string;
  catalogProductId: string;
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  notes: string | null;
  addedBy: string | null;
  addedByName: string | null;
  source: SessionSource;
  roundNumber: number;
  status: ItemStatus;
  createdAt: string;
}

export interface SessionStats {
  openCount: number;
  settledToday: number;
  revenueToday: number;
}

export interface FloorPlan {
  id: string;
  organizationId: string;
  name: string;
  paymentMode: string;
  estimatedPrepTime: number;
  orderingEnabled: boolean;
  activeCatalogId: string | null;
  activeCatalogName: string | null;
  width: number;
  height: number;
  isActive: boolean;
  tableCount: number;
}

export interface Table {
  id: string;
  floorPlanId: string;
  label: string;
  code: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: string;
  capacity: number;
  status: string;
  isActive: boolean;
}

export const sessionsApi = {
  list: (params?: { status?: SessionStatus; tableId?: string; catalogId?: string; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.tableId) searchParams.set('tableId', params.tableId);
    if (params?.catalogId) searchParams.set('catalogId', params.catalogId);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    const qs = searchParams.toString();
    return apiClient.get<{ sessions: Session[]; pagination: { total: number } }>(
      `/sessions${qs ? `?${qs}` : ''}`
    );
  },

  get: (id: string) =>
    apiClient.get<{ session: Session; items: SessionItem[] }>(`/sessions/${id}`),

  getStats: (catalogId?: string) => {
    const params = catalogId ? `?catalogId=${catalogId}` : '';
    return apiClient.get<SessionStats>(`/sessions/stats${params}`);
  },

  getForTable: (tableId: string) =>
    apiClient.get<{ session: Session | null; items: SessionItem[] }>(`/sessions/table/${tableId}`),

  create: (data: {
    catalogId: string;
    tableId?: string;
    source?: 'pos' | 'hold';
    holdName?: string;
    customerEmail?: string;
    customerName?: string;
    guestCount?: number;
    deviceId?: string;
    orderNotes?: string;
    items?: { catalogProductId: string; quantity: number; notes?: string }[];
    settleImmediately?: boolean;
    tipAmount?: number;
    paymentMethod?: string;
    stripePaymentIntentId?: string;
    cashTendered?: number;
  }) => apiClient.post<{ session: Session; items: SessionItem[] }>('/sessions', data),

  addItems: (
    sessionId: string,
    items: { catalogProductId: string; quantity: number; notes?: string }[],
    roundNotes?: string,
  ) =>
    apiClient.post<{ items: SessionItem[]; roundNumber: number; roundNotes: string | null }>(
      `/sessions/${sessionId}/items`,
      { items, roundNotes },
    ),

  removeItem: (sessionId: string, itemId: string) =>
    apiClient.delete<{ success: boolean }>(`/sessions/${sessionId}/items/${itemId}`),

  updateItemStatus: (sessionId: string, itemIds: string[], status: ItemStatus) =>
    apiClient.patch<{ success: boolean }>(`/sessions/${sessionId}/items/status`, { itemIds, status }),

  settle: (sessionId: string, data: {
    tipAmount?: number;
    paymentMethod: string;
    stripePaymentIntentId?: string;
    cashTendered?: number;
  }) => apiClient.post<{ session: Session; order: { id: string; orderNumber: string; totalAmount: number } }>(
    `/sessions/${sessionId}/settle`, data
  ),

  cancel: (sessionId: string, reason?: string) =>
    apiClient.post<{ success: boolean }>(`/sessions/${sessionId}/cancel`, { reason }),

  update: (sessionId: string, data: {
    holdName?: string | null;
    customerName?: string | null;
    customerEmail?: string | null;
    orderNotes?: string | null;
    internalNotes?: string | null;
  }) => apiClient.patch<{ success: boolean }>(`/sessions/${sessionId}`, data),

  // Tab management
  openTab: (sessionId: string, data: { stripeSetupIntentId: string; stripePaymentMethodId: string; customerName?: string }) =>
    apiClient.post<{ success: boolean }>(`/sessions/${sessionId}/open-tab`, data),

  closeTab: (sessionId: string, tipAmount?: number) =>
    apiClient.post<{ session: Session; order: { id: string; orderNumber: string; totalAmount: number } }>(
      `/sessions/${sessionId}/close-tab`, { tipAmount: tipAmount || 0 }
    ),

  listTabs: () =>
    apiClient.get<{ tabs: Session[] }>('/sessions/tabs'),
};

export const floorPlansApi = {
  list: () =>
    apiClient.get<{ floorPlans: FloorPlan[] }>('/floor-plans'),

  get: (id: string) =>
    apiClient.get<{ floorPlan: FloorPlan; tables: Table[] }>(`/floor-plans/${id}`),
};
