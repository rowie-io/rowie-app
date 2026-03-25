import { apiClient } from './client';

export interface OrderItem {
  productId: string;
  catalogProductId?: string;
  categoryId?: string;
  name: string;
  quantity: number;
  unitPrice: number; // in cents
  notes?: string; // per-item special instructions
}

export interface Order {
  id: string;
  orderNumber: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded' | 'held';
  paymentMethod: 'card' | 'cash' | 'tap_to_pay' | 'split' | null;
  subtotal: number; // in cents
  taxAmount: number;
  tipAmount: number;
  totalAmount: number;
  stripePaymentIntentId: string | null;
  customerEmail: string | null;
  customerId: string | null;
  catalogId: string | null;
  userId: string | null;
  deviceId: string | null;
  notes: string | null; // order-level notes
  holdName: string | null; // name for held orders
  heldAt: string | null; // when order was held
  heldBy: string | null; // user who held it
  itemCount?: number; // for held orders list
  items?: Array<{
    id: string;
    productId: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
    notes?: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderParams {
  catalogId?: string;
  items?: OrderItem[];
  subtotal: number; // in cents
  taxAmount?: number;
  tipAmount?: number;
  totalAmount: number; // in cents
  paymentMethod?: 'card' | 'cash' | 'tap_to_pay' | 'split';
  customerEmail?: string;
  stripePaymentIntentId?: string;
  isQuickCharge?: boolean;
  description?: string;
  deviceId?: string;
  notes?: string; // order-level notes
  holdName?: string; // for creating held orders
}

export interface OrdersListParams {
  limit?: number;
  offset?: number;
  status?: string;
  deviceId?: string;
  userId?: string;
}

export interface OrdersListResponse {
  orders: Order[];
  total: number;
}

export interface HeldOrdersResponse {
  orders: Order[];
}

export interface CashPaymentResponse {
  order: Order;
  changeAmount: number;
}

export interface OrderPayment {
  id: string;
  paymentMethod: 'card' | 'cash' | 'tap_to_pay';
  amount: number;
  tipAmount: number;
  status: string;
  cashTendered: number | null;
  cashChange: number | null;
  stripePaymentIntentId?: string | null;
  createdAt?: string;
}

export interface AddPaymentParams {
  paymentMethod: 'card' | 'cash' | 'tap_to_pay';
  amount: number; // in cents
  tipAmount?: number;
  stripePaymentIntentId?: string;
  cashTendered?: number; // for cash payments
  readerId?: string;
  readerLabel?: string;
  readerType?: 'bluetooth' | 'internet' | 'tap_to_pay';
}

export interface AddPaymentResponse {
  payment: OrderPayment;
  orderStatus: string;
  totalPaid: number;
  remainingBalance: number;
}

export interface OrderPaymentsResponse {
  payments: OrderPayment[];
  totalPaid: number;
  orderTotal: number;
  remainingBalance: number;
}

export const ordersApi = {
  /**
   * Create a new order
   * Call this BEFORE creating a Stripe PaymentIntent
   */
  create: (params: CreateOrderParams) =>
    apiClient.post<Order>('/orders', params),

  /**
   * Link a Stripe PaymentIntent to an existing order
   * Optionally update the payment method (e.g., when falling back to manual card entry)
   */
  linkPaymentIntent: (
    orderId: string,
    stripePaymentIntentId: string,
    paymentMethod?: 'card' | 'cash' | 'tap_to_pay',
    readerInfo?: { readerId?: string; readerLabel?: string; readerType?: 'bluetooth' | 'internet' | 'tap_to_pay' },
  ) =>
    apiClient.patch<Order>(`/orders/${orderId}/payment-intent`, {
      stripePaymentIntentId,
      ...(paymentMethod && { paymentMethod }),
      ...readerInfo,
    }),

  /**
   * Get order by ID
   */
  get: (orderId: string) =>
    apiClient.get<Order>(`/orders/${orderId}`),

  /**
   * List orders for the organization
   * Optionally filter by deviceId or userId
   */
  list: (params?: OrdersListParams) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());
    if (params?.status) searchParams.append('status', params.status);
    if (params?.deviceId) searchParams.append('deviceId', params.deviceId);
    if (params?.userId) searchParams.append('userId', params.userId);

    const query = searchParams.toString();
    return apiClient.get<OrdersListResponse>(`/orders${query ? `?${query}` : ''}`);
  },

  // ============================================
  // Held Orders (Open Tabs)
  // ============================================

  /**
   * Put an order on hold (open tab)
   * Optionally update order fields when re-holding a resumed order
   */
  hold: (orderId: string, holdName?: string, updates?: {
    tipAmount?: number;
    taxAmount?: number;
    subtotal?: number;
    totalAmount?: number;
    paymentMethod?: string;
    customerEmail?: string;
    notes?: string | null;
  }) =>
    apiClient.post<Order>(`/orders/${orderId}/hold`, { holdName, ...updates }),

  /**
   * Resume a held order
   */
  resume: (orderId: string) =>
    apiClient.post<Order>(`/orders/${orderId}/resume`, {}),

  /**
   * List held orders for the organization
   */
  listHeld: (deviceId?: string) => {
    const searchParams = new URLSearchParams();
    if (deviceId) searchParams.append('deviceId', deviceId);
    const query = searchParams.toString();
    return apiClient.get<HeldOrdersResponse>(`/orders/held${query ? `?${query}` : ''}`);
  },

  /**
   * Cancel/delete a pending or held order
   */
  cancel: (orderId: string) =>
    apiClient.delete<{ success: boolean; message: string }>(`/orders/${orderId}`),

  // ============================================
  // Cash Payments
  // ============================================

  /**
   * Complete an order with cash payment
   */
  completeCash: (orderId: string, cashTendered: number) =>
    apiClient.post<CashPaymentResponse>(`/orders/${orderId}/complete-cash`, { cashTendered }),

  // ============================================
  // Split Payments
  // ============================================

  /**
   * Add a payment to an order (for split payments)
   */
  addPayment: (orderId: string, params: AddPaymentParams) =>
    apiClient.post<AddPaymentResponse>(`/orders/${orderId}/payments`, params),

  /**
   * Get payments for an order
   */
  getPayments: (orderId: string) =>
    apiClient.get<OrderPaymentsResponse>(`/orders/${orderId}/payments`),
};
