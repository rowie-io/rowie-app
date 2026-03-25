import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../config';
import logger from '../logger';

export type ApiError = {
  error: string;
  statusCode?: number;
  code?: string; // Specific error code like 'SESSION_KICKED'
  details?: any;
};

// Callback for handling session kicked events
let onSessionKickedCallback: (() => void) | null = null;

export function setOnSessionKicked(callback: () => void) {
  onSessionKickedCallback = callback;
}

interface RequestQueueItem {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  request: () => Promise<any>;
}

class ApiClient {
  private baseURL: string;
  private defaultHeaders: HeadersInit;
  private refreshPromise: Promise<any> | null = null;
  private requestQueue: RequestQueueItem[] = [];
  private isRefreshing = false;
  private sessionKicked = false;

  constructor() {
    this.baseURL = config.apiUrl;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
  }

  private async getAuthToken(): Promise<string | null> {
    return AsyncStorage.getItem('accessToken');
  }

  private async processRequestQueue() {
    const queue = [...this.requestQueue];
    this.requestQueue = [];

    for (const queueItem of queue) {
      try {
        const result = await queueItem.request();
        queueItem.resolve(result);
      } catch (error) {
        queueItem.reject(error);
      }
    }
  }

  private async handleTokenRefresh(): Promise<boolean> {
    logger.log('[ApiClient] handleTokenRefresh called, isRefreshing:', this.isRefreshing);

    if (this.isRefreshing) {
      logger.log('[ApiClient] Already refreshing, queueing request');
      return new Promise((resolve, reject) => {
        this.requestQueue.push({
          resolve: () => resolve(true),
          reject,
          request: async () => true
        });
      });
    }

    this.isRefreshing = true;

    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        try {
          // Dynamic import to avoid circular dependency
          const { authService } = await import('./auth');
          const refreshToken = await AsyncStorage.getItem('refreshToken');

          if (!refreshToken) {
            logger.log('[ApiClient] No refresh token available');
            throw new Error('No refresh token available');
          }

          logger.log('[ApiClient] Attempting token refresh...');
          const tokens = await authService.refreshTokens();

          if (tokens) {
            logger.log('[ApiClient] Token refresh successful');
            this.isRefreshing = false;
            this.refreshPromise = null;
            this.processRequestQueue();
            return true;
          } else {
            throw new Error('Failed to refresh tokens');
          }
        } catch (error: any) {
          logger.log('[ApiClient] Token refresh failed:', error?.message || error);
          this.isRefreshing = false;
          this.refreshPromise = null;
          this.requestQueue = [];
          throw error;
        }
      })();
    }

    return this.refreshPromise;
  }

  private async handleResponse<T>(
    response: Response,
    endpoint: string,
    retryCount: number = 0,
    method?: string,
    data?: any,
    options?: RequestInit
  ): Promise<T> {
    if (!response.ok) {
      const error: ApiError = {
        error: 'Request failed',
        statusCode: response.status,
      };

      try {
        const responseData = await response.json();
        error.error = responseData.error || responseData.message || 'Request failed';
        error.code = responseData.code;
        error.details = responseData;
      } catch {
        error.error = `Request failed with status ${response.status}`;
      }

      // Check if session was kicked (logged in on another device)
      if (response.status === 401 && error.code === 'SESSION_KICKED') {
        logger.log('[ApiClient] Session kicked - user logged in on another device');
        this.sessionKicked = true;
        if (onSessionKickedCallback) {
          onSessionKickedCallback();
        }
        throw error;
      }

      // Don't attempt refresh for auth endpoints
      const authEndpoints = ['/auth/login', '/auth/refresh', '/auth/forgot-password', '/auth/reset-password'];
      const isAuthEndpoint = authEndpoints.some(auth => endpoint.includes(auth));

      // If we get a 401 and haven't retried yet, try to refresh the token
      if (response.status === 401 && retryCount === 0 && !isAuthEndpoint && !this.sessionKicked) {
        logger.log('[ApiClient] Got 401 on', endpoint, '- attempting token refresh');
        try {
          const refreshed = await this.handleTokenRefresh();
          if (refreshed) {
            logger.log('[ApiClient] Refresh succeeded, retrying request to', endpoint);
            // Retry the original request with same method and data
            return this.retryRequest<T>(endpoint, retryCount + 1, method, data, options);
          }
        } catch (refreshError: any) {
          logger.log('[ApiClient] Refresh failed for', endpoint, ':', refreshError?.message);
          // Refresh failed, throw the original error
        }
      }

      throw error;
    }

    try {
      return await response.json();
    } catch {
      return {} as T;
    }
  }

  private async retryRequest<T>(
    endpoint: string,
    retryCount: number,
    method: string = 'GET',
    data?: any,
    options?: RequestInit
  ): Promise<T> {
    // Small delay to ensure AsyncStorage write is complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Get fresh token after refresh
    const token = await this.getAuthToken();
    logger.log('[ApiClient] Retry using token:', token ? token.substring(0, 50) + '...' : 'null');

    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      method,
      headers: await this.getHeaders(options?.headers),
      body: data ? JSON.stringify(data) : undefined,
    });

    return this.handleResponse<T>(response, endpoint, retryCount, method, data, options);
  }

  private async getSessionVersion(): Promise<string | null> {
    return AsyncStorage.getItem('sessionVersion');
  }

  private async getHeaders(customHeaders?: HeadersInit): Promise<HeadersInit> {
    const headers: Record<string, string> = {
      ...this.defaultHeaders as Record<string, string>,
      ...customHeaders as Record<string, string>,
    };

    const token = await this.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Add session version header for single session enforcement
    const sessionVersion = await this.getSessionVersion();
    if (sessionVersion) {
      headers['X-Session-Version'] = sessionVersion;
    }

    return headers;
  }

  private async makeRequest<T>(method: string, endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    if (this.isRefreshing && endpoint !== '/auth/refresh') {
      return new Promise((resolve, reject) => {
        this.requestQueue.push({
          resolve,
          reject,
          request: () => this.makeRequest(method, endpoint, data, options)
        });
      });
    }

    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      method,
      headers: await this.getHeaders(options?.headers),
      body: data ? JSON.stringify(data) : undefined,
    });

    return this.handleResponse<T>(response, endpoint, 0, method, data, options);
  }

  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.makeRequest<T>('GET', endpoint, undefined, options);
  }

  async post<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.makeRequest<T>('POST', endpoint, data, options);
  }

  async put<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.makeRequest<T>('PUT', endpoint, data, options);
  }

  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.makeRequest<T>('DELETE', endpoint, undefined, options);
  }

  async patch<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.makeRequest<T>('PATCH', endpoint, data, options);
  }

  /**
   * POST with FormData (for file uploads)
   * Does not set Content-Type header - let browser set it with boundary
   */
  async postForm<T>(endpoint: string, formData: FormData): Promise<T> {
    if (this.isRefreshing && endpoint !== '/auth/refresh') {
      return new Promise((resolve, reject) => {
        this.requestQueue.push({
          resolve,
          reject,
          request: () => this.postForm(endpoint, formData)
        });
      });
    }

    const token = await this.getAuthToken();
    const sessionVersion = await this.getSessionVersion();

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (sessionVersion) {
      headers['X-Session-Version'] = sessionVersion;
    }

    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    return this.handleResponse<T>(response, endpoint, 0, 'POST', undefined, { headers });
  }

  resetSessionKicked() {
    this.sessionKicked = false;
  }
}

export const apiClient = new ApiClient();
