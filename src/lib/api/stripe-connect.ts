import { apiClient } from './client';

export interface ConnectStatus {
  hasConnectedAccount: boolean;
  onboardingComplete: boolean;
  onboardingState: 'not_started' | 'incomplete' | 'pending_verification' | 'active' | 'restricted' | 'disabled';
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  externalAccountLast4: string | null;
  externalAccountBankName: string | null;
}

export interface OnboardingLink {
  onboardingUrl: string;
}

export const stripeConnectApi = {
  getStatus: () => apiClient.get<ConnectStatus>('/stripe/connect/status'),
  getOnboardingLink: () => apiClient.post<OnboardingLink>('/stripe/connect/onboarding-link', {}),
};
