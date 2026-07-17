import { apiClient } from './client';

export type SessionStatus = 'open' | 'settling' | 'settled' | 'cancelled';
export type SessionSource = 'pos' | 'qr_table' | 'qr_menu' | 'hold' | 'tab';
export type ItemStatus = 'pending' | 'sent' | 'preparing' | 'ready' | 'served';
export type SessionPaymentType = 'pay_now' | 'pay_at_pickup' | 'pay_at_table' | 'tab' | null;

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
  paymentType: SessionPaymentType;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
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
  // Multi-table merge — the session lives on `tableId` (primary) and absorbs
  // every id in `mergedTableIds` (secondaries). Secondary `Table.status` is
  // flipped to 'merged' API-side so the floor plan view hides them visually.
  mergedTableIds?: string[];
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

export interface SessionRound {
  roundNumber: number;
  notes: string | null;
  createdAt: string | null;
  sentAt: string | null;
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
    apiClient.get<{ session: Session; items: SessionItem[]; rounds: SessionRound[] }>(`/sessions/${id}`),

  getStats: () => apiClient.get<SessionStats>('/sessions/stats'),

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
    /** Round-1 notes for the kitchen display when items are submitted with create. */
    roundNotes?: string;
    items?: { catalogProductId: string; quantity: number; notes?: string }[];
    settleImmediately?: boolean;
    // Integer SMALLEST currency unit (cents) — unlike settle()'s tipAmount,
    // which is in BASE units (dollars), per the API's Zod schemas.
    tipAmount?: number;
    paymentMethod?: string;
    stripePaymentIntentId?: string;
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

  // Per-item edit (qty / notes) on an open session — used by SessionDetail to
  // adjust the order before close-out. PATCH route only accepts quantity +
  // notes; status updates go through the bulk endpoint below.
  updateItem: (
    sessionId: string,
    itemId: string,
    data: { quantity?: number; notes?: string | null },
  ) => apiClient.patch<{ item: SessionItem }>(`/sessions/${sessionId}/items/${itemId}`, data),

  // The API's bulk status route only accepts forward targets — 'pending' is an
  // insert-time default, never a valid transition target.
  updateItemStatus: (sessionId: string, itemIds: string[], status: 'sent' | 'preparing' | 'ready' | 'served') =>
    apiClient.patch<{ success: boolean }>(`/sessions/${sessionId}/items/status`, { itemIds, status }),

  settle: (sessionId: string, data: {
    // BASE currency units (dollars) — unlike create()'s tipAmount, which is in
    // integer smallest units (cents), per the API's Zod schemas.
    tipAmount?: number;
    paymentMethod: 'card' | 'cash' | 'tap_to_pay' | 'split';
    stripePaymentIntentId?: string;
    cashTendered?: number;
    // Required when paymentMethod === 'split'. Sum of piece amounts must
    // equal subtotal+tax (tip is allocated pro-rata server-side).
    payments?: Array<{
      paymentMethod: 'card' | 'cash' | 'tap_to_pay';
      amount: number;
      stripePaymentIntentId?: string;
      cashTendered?: number;
    }>;
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

  // tipAmount here is in integer SMALLEST units (cents) per the API's Zod.
  // `order`/`payment` are null (+ `empty: true`) when a tab with no items is
  // closed without charging.
  closeTab: (sessionId: string, tipAmount?: number) =>
    apiClient.post<{
      session: { id: string; status: string };
      order: { id: string; orderNumber: string; totalAmount: number } | null;
      payment: { paymentIntentId: string; amount: number; status: string } | null;
      empty?: boolean;
    }>(
      `/sessions/${sessionId}/close-tab`, { tipAmount: tipAmount || 0 }
    ),

  listTabs: () =>
    apiClient.get<{ tabs: Session[] }>('/sessions/tabs'),

  // Merge another table into this session. Secondary table flips to 'merged'
  // status server-side and disappears from the canvas; QR scans on it still
  // resolve to this session.
  mergeTables: (sessionId: string, tableId: string) =>
    apiClient.post<{ success: boolean; mergedTableIds: string[] }>(
      `/sessions/${sessionId}/merge`, { tableId }
    ),

  unmergeTable: (sessionId: string, tableId: string) =>
    apiClient.post<{ success: boolean; mergedTableIds: string[] }>(
      `/sessions/${sessionId}/unmerge`, { tableId }
    ),
};

export const floorPlansApi = {
  list: () =>
    apiClient.get<{ floorPlans: FloorPlan[] }>('/floor-plans'),

  get: (id: string) =>
    apiClient.get<{ floorPlan: FloorPlan; tables: Table[] }>(`/floor-plans/${id}`),
};
