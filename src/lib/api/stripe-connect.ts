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

export interface CreateAccountResponse {
  accountId: string;
  // The API omits onboardingUrl when the account is already fully onboarded
  // (status 'complete') or gated by the fraud review ('needs_review').
  onboardingUrl?: string;
  status?: 'new' | 'resume' | 'complete' | 'needs_review';
}

export const stripeConnectApi = {
  getStatus: () => apiClient.get<ConnectStatus>('/stripe/connect/status'),
  getOnboardingLink: () => apiClient.post<OnboardingLink>('/stripe/connect/onboarding-link', {}),
  createAccount: (country = 'US') =>
    apiClient.post<CreateAccountResponse>('/stripe/connect/create-account', { country }),
};
