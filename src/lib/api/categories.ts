import { apiClient } from './client';

export interface Category {
  id: string;
  catalogId: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryData {
  name: string;
  description?: string | null;
  isActive?: boolean;
}

export interface UpdateCategoryData {
  name?: string;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export const categoriesApi = {
  /**
   * List all categories for a specific catalog
   */
  list: (catalogId: string) => apiClient.get<Category[]>(`/catalogs/${catalogId}/categories`),

  /**
   * Get a single category by ID
   */
  get: (catalogId: string, id: string) => apiClient.get<Category>(`/catalogs/${catalogId}/categories/${id}`),

  /**
   * Create a new category in a catalog
   */
  create: (catalogId: string, data: CreateCategoryData) =>
    apiClient.post<Category>(`/catalogs/${catalogId}/categories`, data),

  /**
   * Update a category
   */
  update: (catalogId: string, id: string, data: UpdateCategoryData) =>
    apiClient.patch<Category>(`/catalogs/${catalogId}/categories/${id}`, data),

  /**
   * Delete a category (products become uncategorized)
   */
  delete: (catalogId: string, id: string) =>
    apiClient.delete(`/catalogs/${catalogId}/categories/${id}`),

  /**
   * Reorder categories
   */
  reorder: (catalogId: string, categoryIds: string[]) =>
    apiClient.post<{ success: boolean }>(`/catalogs/${catalogId}/categories/reorder`, { categoryIds }),
};
