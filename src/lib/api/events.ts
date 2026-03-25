import { apiClient } from './client';

export interface EventScanResult {
  valid: boolean;
  reason?: string;
  message: string;
  // Ticket info (returned at root level for valid/already-used scans)
  customerName?: string | null;
  customerEmail?: string;
  tierName?: string;
  eventName?: string;
  amountPaid?: number;
  usedAt?: string | null;
  // For wrong event errors
  ticketEvent?: string;
}

export interface OrgEvent {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: string;
  ticketsSold: number;
  ticketsScanned: number;
}

export interface RecentScan {
  id: string;
  customerName: string | null;
  customerEmail: string;
  tierName: string;
  usedAt: string;
  usedDeviceId: string | null;
}

export const eventsApi = {
  list: () =>
    apiClient.get<{ events: OrgEvent[] }>('/events'),

  scan: (qrCode: string, eventId?: string, deviceId?: string | null) =>
    apiClient.post<EventScanResult>('/events/scan', { qrCode, eventId, deviceId }),

  getRecentScans: (eventId: string, deviceId?: string | null, limit?: number) => {
    const params = new URLSearchParams();
    if (deviceId) params.set('deviceId', deviceId);
    if (limit) params.set('limit', limit.toString());
    const qs = params.toString();
    return apiClient.get<{ scans: RecentScan[] }>(`/events/${eventId}/scans${qs ? `?${qs}` : ''}`);
  },
};
