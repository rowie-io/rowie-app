import { apiClient } from './client';

export type CatalogLayoutType = 'grid' | 'list' | 'large-grid' | 'compact';
export type PreorderPaymentMode = 'pay_now' | 'pay_at_pickup' | 'both';

export interface Catalog {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  date: string | null;
  productCount: number;
  isActive: boolean;
  showTipScreen: boolean;
  promptForEmail: boolean;
  tipPercentages: number[];
  allowCustomTip: boolean;
  taxRate: number;
  layoutType: CatalogLayoutType;
  isLocked?: boolean;
  // Preorder settings
  preorderEnabled: boolean;
  slug: string | null;
  preorderPaymentMode: PreorderPaymentMode;
  pickupInstructions: string | null;
  estimatedPrepTime: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCatalogData {
  name: string;
  description?: string | null;
  location?: string | null;
  date?: string | null;
  isActive?: boolean;
  showTipScreen?: boolean;
  promptForEmail?: boolean;
  tipPercentages?: number[];
  allowCustomTip?: boolean;
  taxRate?: number;
  layoutType?: CatalogLayoutType;
}

export interface UpdateCatalogData {
  name?: string;
  description?: string | null;
  location?: string | null;
  date?: string | null;
  isActive?: boolean;
  showTipScreen?: boolean;
  promptForEmail?: boolean;
  tipPercentages?: number[];
  allowCustomTip?: boolean;
  taxRate?: number;
  layoutType?: CatalogLayoutType;
}

export const catalogsApi = {
  /**
   * List all catalogs for the organization
   */
  list: () => apiClient.get<Catalog[]>('/catalogs'),

  /**
   * Get a single catalog by ID
   */
  get: (id: string) => apiClient.get<Catalog>(`/catalogs/${id}`),

  /**
   * Create a new catalog
   */
  create: (data: CreateCatalogData) => apiClient.post<Catalog>('/catalogs', data),

  /**
   * Update a catalog
   */
  update: (id: string, data: UpdateCatalogData) => apiClient.put<Catalog>(`/catalogs/${id}`, data),

  /**
   * Delete a catalog
   */
  delete: (id: string) => apiClient.delete<{ success: boolean }>(`/catalogs/${id}`),

  /**
   * Duplicate a catalog (copies all products and settings)
   */
  duplicate: (id: string, name?: string) =>
    apiClient.post<Catalog>(`/catalogs/${id}/duplicate`, name ? { name } : {}),
};
