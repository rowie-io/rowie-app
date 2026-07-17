import { apiClient } from './client';

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'partially_refunded';

// API-side these come from the bookings.payment_type column. 'pay_now' = paid
// online at booking; 'pay_at_visit' / 'pay_at_event' = vendor takes payment
// when the customer arrives (the case the in-app Take Payment flow targets).
// Both visit/event values exist in the wild because the vendor portal saves
// 'pay_at_event' as the config-level mode but booking-public.ts assigns
// 'pay_at_visit' when a 'both' mode falls through to deferred payment.
export type BookingPaymentType = 'pay_now' | 'pay_at_visit' | 'pay_at_event';

export interface Booking {
  id: string;
  organizationId: string;
  bookingConfigId: string | null;
  bookingServiceId: string;
  serviceName: string | null;
  bookingNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  bookingDate: string;
  startTime: string;
  endTime: string;
  timezone: string;
  paymentType: BookingPaymentType;
  price: number;
  taxAmount: number;
  totalAmount: number;
  currency: string | null;
  platformFeeCents: number;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  status: BookingStatus;
  amountRefunded: number;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  completedAt: string | null;
  completedBy: string | null;
  customerNotes: string | null;
  internalNotes: string | null;
  reminderSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingListResponse {
  bookings: Booking[];
  pagination?: { total: number; page: number; limit: number };
}

export interface BookingTerminalPaymentIntentResponse {
  id: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: string;
  stripeAccountId: string;
}

export interface ListBookingsParams {
  status?: BookingStatus;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

function buildQuery(params: ListBookingsParams): string {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.search) q.set('search', params.search);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const bookingsApi = {
  list: (params: ListBookingsParams = {}) =>
    apiClient.get<BookingListResponse>(`/bookings${buildQuery(params)}`),

  get: (id: string) =>
    apiClient.get<{ booking: Booking }>(`/bookings/${id}`),

  // Pay-at-appointment: create a Tap to Pay PaymentIntent for the booking.
  // The Connect webhook marks the booking paid on success and emits
  // BOOKING_UPDATED.
  createTerminalPaymentIntent: (id: string, tipAmount?: number) =>
    apiClient.post<BookingTerminalPaymentIntentResponse>(
      `/bookings/${id}/terminal-payment-intent`,
      { tipAmount }
    ),
};

/**
 * Returns true if the booking has been paid (has a Stripe PI attached).
 * Pay-now bookings always have a PI; pay-at-appointment bookings only get
 * one after the vendor takes payment in the POS.
 */
export function isBookingPaid(b: Booking): boolean {
  return !!b.stripePaymentIntentId;
}
