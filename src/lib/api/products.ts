import { apiClient } from './client';

// ============================================================================
// Product Library Types (organization-level products without pricing)
// ============================================================================

export interface LibraryProduct {
  id: string;
  name: string;
  description: string | null;
  imageId: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLibraryProductData {
  name: string;
  description?: string | null;
}

export interface UpdateLibraryProductData {
  name?: string;
  description?: string | null;
}

// ============================================================================
// Catalog Product Types (product in a specific catalog with pricing)
// ============================================================================

export interface CatalogProduct {
  id: string; // catalog_product id
  catalogId: string;
  productId: string;
  categoryId: string | null;
  price: number; // In cents
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  product: LibraryProduct;
  category: {
    id: string;
    name: string;
  } | null;
}

// Flattened product structure for convenience in UI
export interface Product {
  id: string; // catalog_product id
  productId: string; // actual product id
  catalogId: string;
  name: string;
  description: string | null;
  price: number; // In cents
  imageId: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCatalogProductData {
  productId: string;
  price: number;
  categoryId?: string | null;
  isActive?: boolean;
}

export interface UpdateCatalogProductData {
  categoryId?: string | null;
  price?: number;
  sortOrder?: number;
  isActive?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

export function flattenCatalogProduct(cp: CatalogProduct): Product {
  return {
    id: cp.id,
    productId: cp.productId,
    catalogId: cp.catalogId,
    name: cp.product.name,
    description: cp.product.description,
    price: cp.price,
    imageId: cp.product.imageId,
    imageUrl: cp.product.imageUrl,
    categoryId: cp.categoryId,
    categoryName: cp.category?.name || null,
    isActive: cp.isActive,
    sortOrder: cp.sortOrder,
    createdAt: cp.createdAt,
    updatedAt: cp.updatedAt,
  };
}

// ============================================================================
// Product Library API (organization-level products)
// ============================================================================

export const libraryProductsApi = {
  /**
   * List all products in the organization library
   */
  list: () => apiClient.get<LibraryProduct[]>('/products'),

  /**
   * Get a single product from the library
   */
  get: (productId: string) => apiClient.get<LibraryProduct>(`/products/${productId}`),

  /**
   * Create a new product in the library
   */
  create: (data: CreateLibraryProductData) => apiClient.post<LibraryProduct>('/products', data),

  /**
   * Update a product in the library
   */
  update: (productId: string, data: UpdateLibraryProductData) =>
    apiClient.patch<LibraryProduct>(`/products/${productId}`, data),

  /**
   * Upload an image for a product
   */
  uploadImage: (productId: string, imageUri: string, fileName: string, mimeType: string) => {
    const formData = new FormData();
    formData.append('image', {
      uri: imageUri,
      name: fileName,
      type: mimeType,
    } as any);
    return apiClient.postForm<LibraryProduct>(`/products/${productId}/image`, formData);
  },

  /**
   * Delete a product from the library
   */
  delete: (productId: string) => apiClient.delete(`/products/${productId}`),

  /**
   * Duplicate a product in the library
   */
  duplicate: (productId: string, name?: string) =>
    apiClient.post<LibraryProduct>(`/products/${productId}/duplicate`, name ? { name } : {}),
};

// ============================================================================
// Catalog Products API (products in a specific catalog with pricing)
// ============================================================================

export const catalogProductsApi = {
  /**
   * List all products in a catalog (returns raw CatalogProduct structure)
   */
  listRaw: (catalogId: string) => apiClient.get<CatalogProduct[]>(`/catalogs/${catalogId}/products`),

  /**
   * Get a single product in a catalog (returns raw CatalogProduct structure)
   */
  getRaw: (catalogId: string, catalogProductId: string) =>
    apiClient.get<CatalogProduct>(`/catalogs/${catalogId}/products/${catalogProductId}`),

  /**
   * Add a product to a catalog
   */
  add: (catalogId: string, data: CreateCatalogProductData) =>
    apiClient.post<CatalogProduct>(`/catalogs/${catalogId}/products`, data),

  /**
   * Update a product in a catalog (price, category, visibility, sort order)
   */
  update: (catalogId: string, catalogProductId: string, data: UpdateCatalogProductData) =>
    apiClient.patch<CatalogProduct>(`/catalogs/${catalogId}/products/${catalogProductId}`, data),

  /**
   * Remove a product from a catalog
   */
  remove: (catalogId: string, catalogProductId: string) =>
    apiClient.delete(`/catalogs/${catalogId}/products/${catalogProductId}`),

  /**
   * Bulk add products to a catalog
   */
  bulkAdd: (catalogId: string, productIds: string[], defaultPrice: number) =>
    apiClient.post<{ added: number }>(`/catalogs/${catalogId}/products/bulk`, {
      productIds,
      defaultPrice,
    }),

  /**
   * Reorder products in a catalog
   */
  reorder: (catalogId: string, productOrders: Array<{ catalogProductId: string; sortOrder: number }>) =>
    apiClient.post<{ success: boolean }>(`/catalogs/${catalogId}/products/reorder`, { productOrders }),
};

// ============================================================================
// Convenience API (for backward compatibility and simpler usage)
// ============================================================================

export const productsApi = {
  /**
   * List all products in a catalog (returns flattened structure)
   */
  list: async (catalogId: string): Promise<Product[]> => {
    const catalogProducts = await catalogProductsApi.listRaw(catalogId);
    return catalogProducts.map(flattenCatalogProduct);
  },

  /**
   * Get a single product by ID (returns flattened structure)
   */
  get: async (catalogId: string, catalogProductId: string): Promise<Product> => {
    const catalogProduct = await catalogProductsApi.getRaw(catalogId, catalogProductId);
    return flattenCatalogProduct(catalogProduct);
  },
};
