import { apiClient } from './client';

export interface Organization {
  id: string;
  name: string;
  slug?: string;
  stripeAccountId?: string | null;
  stripeOnboardingCompleted?: boolean;
  settings?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

class OrganizationsService {
  /**
   * Get organization by ID
   */
  async getById(id: string): Promise<Organization> {
    return apiClient.get(`/organizations/${id}`);
  }

  /**
   * Update organization
   */
  async update(id: string, data: Partial<Organization>): Promise<Organization> {
    return apiClient.patch(`/organizations/${id}`, data);
  }
}

export const organizationsService = new OrganizationsService();
