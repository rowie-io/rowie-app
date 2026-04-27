export { apiClient } from './client';
export type { ApiError } from './client';

export { authService } from './auth';
export type {
  User,
  Organization,
  AuthTokens,
  LoginCredentials,
  LoginResponse,
  Subscription,
} from './auth';

export { catalogsApi } from './catalogs';
export type {
  Catalog,
  CatalogLayoutType,
  CreateCatalogData,
  UpdateCatalogData,
} from './catalogs';

export { productsApi, catalogProductsApi, libraryProductsApi, flattenCatalogProduct } from './products';
export type {
  Product,
  CatalogProduct,
  LibraryProduct,
  CreateLibraryProductData,
  UpdateLibraryProductData,
  CreateCatalogProductData,
  UpdateCatalogProductData,
} from './products';

export { categoriesApi } from './categories';
export type {
  Category,
  CreateCategoryData,
  UpdateCategoryData,
} from './categories';

export { transactionsApi } from './transactions';
export type {
  Transaction,
  TransactionDetail,
  TransactionsListParams,
  TransactionsListResponse,
  PaymentMethod,
  Refund,
  RefundParams,
  SourceType,
} from './transactions';

export { stripeTerminalApi } from './stripe-terminal';
export type {
  ConnectionToken,
  CreatePaymentIntentParams,
  PaymentIntent,
} from './stripe-terminal';

export { organizationsService } from './organizations';

export { ordersApi } from './orders';
export type {
  Order,
  OrderItem,
  CreateOrderParams,
  HeldOrdersResponse,
  CashPaymentResponse,
  OrderPayment,
  AddPaymentParams,
  AddPaymentResponse,
  OrderPaymentsResponse,
} from './orders';

export { stripeConnectApi } from './stripe-connect';
export type { ConnectStatus } from './stripe-connect';

export { eventsApi } from './events';
export type { EventScanResult, OrgEvent, RecentScan } from './events';

// Preorders replaced by sessions — see ./sessions
export { sessionsApi, floorPlansApi } from './sessions';

// Legacy preorders compat shim — only used by TransactionDetailScreen for
// historical order display. Proxies to /preorders/{id} which is a compat
// endpoint on the API that maps table_sessions to the legacy shape.
export { preordersApi } from './preorders';
export type { Preorder, PreorderItem, PreorderStatus, PreorderPaymentType } from './preorders';
export type {
  Session,
  SessionItem,
  SessionStatus,
  SessionSource,
  ItemStatus,
  FloorPlan,
  Table,
} from './sessions';
