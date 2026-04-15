# rowie-app - Mobile POS Application

> **For full ecosystem context, see the root [CLAUDE.md](../CLAUDE.md)**

## Project Overview

rowie-app is a React Native/Expo mobile application for a point-of-sale (POS) system designed for mobile bars, food trucks, and events. The app enables staff to process contactless payments via Stripe Tap to Pay on iPhone/Android, accept cash payments, and handle split payments across multiple methods.

**Tech Stack:**
- **Framework:** React Native 0.81.5 with Expo SDK 54
- **Language:** TypeScript 5.9 (strict mode)
- **Navigation:** React Navigation v7 (native-stack + bottom-tabs)
- **State:** React Context (7 contexts) + TanStack Query v5
- **Payments:** Stripe React Native + Stripe Terminal (Tap to Pay) + Cash + Split Payments
- **Real-time:** Socket.IO client v4.8
- **Storage:** expo-secure-store (tokens), AsyncStorage (preferences/cache)
- **Auth:** Biometric (Face ID / Fingerprint) + email/password
- **Fonts:** Plus Jakarta Sans (Google Fonts)
- **IAP:** react-native-iap v14.7

---

## Apple Tap to Pay Compliance (CRITICAL)

This app implements Tap to Pay on iPhone and must comply with Apple's TTPOi requirements (v1.5, March 2025).

### Device Requirements
- **iPhone:** XS or later (A12 Bionic chip minimum), iOS 16.4+
- **Android:** NFC-capable device, Android 8.0 (SDK 26)+
- **Passcode:** Device must have passcode enabled

### Required Entitlements
1. **Development Entitlement:** Request via Apple Developer portal for testing
2. **Publishing Entitlement:** Required before App Store submission

### iOS Entitlements (app.config.ts)
- `com.apple.developer.proximity-reader.payment.acceptance` — Tap to Pay
- `com.apple.developer.in-app-payments` — In-app payments

### UX Requirements (Apple Mandated)

**Onboarding (Section 2.1-2.3):**
- `TapToPayEducationScreen` and `TapToPayFirstUseModal` educate merchants before first use
- Shows supported card types (Visa, Mastercard, Amex, Discover) and device compatibility
- Explains how contactless payments work

**Checkout Flow (Section 3.1-3.5):**
- Clear total amount display before payment initiation
- Payment sheet shows amount being charged
- Immediate success/failure feedback via `PaymentResultScreen`
- Receipt offering after successful payment (email)

**Error Handling (Section 4.1-4.3):**
- Clear error messages for failed transactions
- Retry option for transient failures
- Guidance for persistent issues

**Dynamic Type / Accessibility (Section 4.4 - MANDATORY):**

Every `<Text>` element MUST have a `maxFontSizeMultiplier` prop to support Dynamic Type while preventing layout breakage at extreme accessibility sizes. React Native enables font scaling by default (`allowFontScaling={true}`), so the multiplier caps are what prevent overflow.

Rules for choosing the value:
- **`fontSize >= 24`** (amounts, large numbers): `maxFontSizeMultiplier={1.2}`
- **`fontSize 17-23`** (titles, headings): `maxFontSizeMultiplier={1.3}`
- **`fontSize <= 16` inside buttons/touchables**: `maxFontSizeMultiplier={1.3}`
- **`fontSize <= 16` body text/labels**: `maxFontSizeMultiplier={1.5}`

```tsx
// Examples
<Text style={styles.amount} maxFontSizeMultiplier={1.2}>$4.50</Text>
<Text style={styles.title} maxFontSizeMultiplier={1.3}>Payment Settings</Text>
<Text style={styles.buttonText} maxFontSizeMultiplier={1.3}>Submit</Text>
<Text style={styles.description} maxFontSizeMultiplier={1.5}>Enter your details</Text>
```

Also use `minHeight` instead of fixed `height` on containers that hold text, so they can expand when text scales up.

**VoiceOver / Accessibility Labels (Section 4.4 - MANDATORY):**

Every interactive element MUST have accessibility props for VoiceOver support. This is required by Apple for TTPOi App Store approval and is enforced across ALL screens and components.

Rules by element type:

- **TouchableOpacity / Pressable (buttons):**
  ```tsx
  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Pay with Tap to Pay">
  ```

- **TextInput:**
  ```tsx
  <TextInput accessibilityLabel="Email address" />
  ```

- **Toggle / Switch:**
  ```tsx
  <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: isEnabled }}>
  ```

- **Links (opening URLs, external navigation):**
  ```tsx
  <TouchableOpacity accessibilityRole="link" accessibilityLabel="Open Vendor Portal">
  ```

- **Alert banners / error messages:**
  ```tsx
  <View accessibilityRole="alert"><Text>Payment failed</Text></View>
  ```

- **Loading indicators:**
  ```tsx
  <ActivityIndicator accessibilityLabel="Loading" />
  ```

- **Images:**
  ```tsx
  <Image accessibilityLabel="Rowie logo" />
  ```

- **Modal close buttons:**
  ```tsx
  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close">
  ```

When to use `accessibilityHint`: Only when the action isn't obvious from the label alone. Example: `accessibilityHint="Double tap to process payment"`.

What NOT to label: Decorative elements (gradients, dividers, spacers).

Dynamic labels: When content is dynamic, build the label from the data:
```tsx
<TouchableOpacity accessibilityLabel={`Refund $${amount} transaction`}>
```

### Mobile-Friendly UI (MANDATORY)

This is a mobile-only app. Every UI element, screen, and component MUST be designed and verified for mobile usage. All new code and modifications must follow these rules:

**Layout:**
- Use `flexDirection: 'row'` with `flexWrap: 'wrap'` or `flex: 1` to prevent horizontal overflow
- Use `marginHorizontal` / `paddingHorizontal` (minimum 16px) to keep content away from screen edges
- Never use fixed widths that could overflow on small screens (iPhone SE = 320pt wide)
- Use percentage-based widths or `flex` for responsive sizing

**Touch Targets:**
- All interactive elements must be at minimum 44x44pt (Apple HIG) or 48x48dp (Material Design)
- Use `hitSlop` to expand tap areas on small icons without increasing visual size
- Provide adequate spacing (`gap: 8-12`) between adjacent tappable elements to prevent mis-taps

**Text & Inputs:**
- All `<Text>` must have `maxFontSizeMultiplier` (see Dynamic Type section above)
- Use `minHeight` instead of fixed `height` on containers that hold text
- All `<TextInput>` should be wrapped in `KeyboardAvoidingView` (behavior `'padding'` on iOS, `'height'` on Android)
- Add `keyboardShouldPersistTaps="handled"` on `ScrollView`s containing inputs

**Feedback & States:**
- Disabled buttons must be visually distinct (reduced opacity, muted colors)
- Loading states must show `ActivityIndicator` with `accessibilityLabel`
- Error/warning/success states must have visible banners or indicators — never rely solely on alerts or disabled states
- Form validation errors must appear inline near the relevant input

**Safe Areas:**
- All screens must use `SafeAreaView` from `react-native-safe-area-context` (not React Native's built-in)
- Specify edges explicitly: `edges={['top', 'bottom', 'left', 'right']}` or as needed
- Bottom-padded footers should account for home indicator on modern iPhones

### Marketing Requirements (Section 5.1-5.3)
- Use official Apple Tap to Pay branding assets
- Follow trademark guidelines
- Include required disclaimers

---

## React Performance Patterns (MANDATORY)

These patterns prevent render loops, excessive re-renders, and crashes. All new code MUST follow these rules.

### 1. Socket Event Handlers — NEVER inline `useCallback` inside `useSocketEvent()`

The `useSocketEvent(event, callback)` hook subscribes/unsubscribes via `useEffect` whenever the callback reference changes. Passing an inline `useCallback` directly creates a new function reference when its dependencies change, triggering rapid subscribe/unsubscribe cycles that cause render loops or crashes.

```tsx
// BAD — inline useCallback recreates on dependency change → subscribe/unsubscribe loop
useSocketEvent(SocketEvents.ORDER_UPDATED, useCallback((data: any) => {
  if (data.catalogId === selectedCatalogId) refreshOrders();
}, [refreshOrders]));

// GOOD — define the handler OUTSIDE, then pass the stable reference
const handleOrderUpdated = useCallback((data: any) => {
  if (data.catalogId === selectedCatalogId) refreshOrders();
}, [refreshOrders]);

useSocketEvent(SocketEvents.ORDER_UPDATED, handleOrderUpdated);
```

Also NEVER include derived/changing values (e.g., `orders.length`, `items.length`) in socket handler `useCallback` dependencies — this causes the handler to recreate on every data change, which triggers re-subscription loops.

### 2. Context Provider Values — ALWAYS memoize with `useMemo`

Every `<Context.Provider value={...}>` MUST wrap the value object in `useMemo`. Without this, a new object reference is created on every render, forcing ALL consumers of that context to re-render unnecessarily.

```tsx
// BAD — new object reference every render, all consumers re-render
return (
  <MyContext.Provider value={{ data, loading, refresh }}>
    {children}
  </MyContext.Provider>
);

// GOOD — stable reference, consumers only re-render when values actually change
const value = useMemo(() => ({ data, loading, refresh }), [data, loading, refresh]);

return (
  <MyContext.Provider value={value}>
    {children}
  </MyContext.Provider>
);
```

All 8 context providers (Auth, Cart, Catalog, Socket, StripeTerminal, Theme, Preorders, Device) follow this pattern.

### 3. List Item Components — ALWAYS wrap with `memo()`

Components rendered inside `FlatList`, `SectionList`, or `.map()` loops MUST be wrapped with `React.memo()` to prevent re-rendering every item when parent state changes.

```tsx
// BAD — re-renders every item on any parent state change
function TransactionItem({ item, onPress }) { ... }

// GOOD — only re-renders when its own props change
const TransactionItem = memo(function TransactionItem({ item, onPress }) { ... });
```

Currently memoized list item components: `AnimatedTransactionItem`, `CategoryPill`, `KeypadButton`.

### 4. Avoid Redundant Data Fetching in Socket Handlers

When multiple places subscribe to the same socket event, ensure only ONE place triggers the data refetch. For example, `CatalogContext` handles `refreshCatalogs()` on `CATALOG_UPDATED` — individual screens should NOT also call `refreshCatalogs()`. Screens should only refetch their own screen-specific data (products, categories, etc.).

### 5. Use setState Callback Pattern to Avoid Stale Closures

When a `useCallback` needs to read and update state, use the functional setState form to avoid including the state variable in dependencies:

```tsx
// BAD — depends on `state.user`, recreates callback on every user change
const completeOnboarding = useCallback(async () => {
  const updatedUser = { ...state.user, onboardingCompleted: true };
  setState({ ...state, user: updatedUser });
}, [state.user]);

// GOOD — no dependency on state, stable callback reference
const completeOnboarding = useCallback(async () => {
  setState(prev => ({
    ...prev,
    user: prev.user ? { ...prev.user, onboardingCompleted: true } : null,
  }));
}, []);
```

### 6. Rules of Hooks — NEVER call hooks conditionally or after early returns

All hooks (`useState`, `useEffect`, `useCallback`, `useMemo`, `useRef`, `useContext`, and custom hooks like `useTheme`, `useSocketEvent`, etc.) MUST be called at the top level of the component, BEFORE any conditional `return` statements. React tracks hooks by call order — if a hook is skipped on one render but called on the next, the app crashes.

```tsx
// BAD — useMemo is after early return, skipped when !isLoaded → crash
if (!isLoaded) {
  return null;
}
const value = useMemo(() => ({ theme, isDark }), [theme, isDark]);

// GOOD — all hooks called before any early return
const value = useMemo(() => ({ theme, isDark }), [theme, isDark]);
if (!isLoaded) {
  return null;
}
```

Also NEVER call hooks inside `if` blocks, loops, ternaries, `switch` cases, or `&&`/`||` expressions.

---

## Directory Structure

```
rowie-app/
├── src/
│   ├── screens/                         # All app screens (18)
│   │   ├── LoginScreen.tsx              # Email/password + biometric login
│   │   ├── SignUpScreen.tsx             # New user registration
│   │   ├── ForgotPasswordScreen.tsx     # Password reset request
│   │   ├── ResetPasswordScreen.tsx      # Password reset completion
│   │   ├── CatalogSelectScreen.tsx      # Catalog selection (modal)
│   │   ├── MenuScreen.tsx               # Product grid with categories
│   │   ├── CartScreen.tsx               # Shopping cart with item notes
│   │   ├── CheckoutScreen.tsx           # Order summary + tip selection
│   │   ├── PaymentProcessingScreen.tsx  # Tap to Pay UI (fullscreen modal)
│   │   ├── PaymentResultScreen.tsx      # Success/failure + receipt
│   │   ├── CashPaymentScreen.tsx        # Cash payment with change calc
│   │   ├── SplitPaymentScreen.tsx       # Split across multiple methods
│   │   ├── TransactionsScreen.tsx       # Transaction history
│   │   ├── TransactionDetailScreen.tsx  # Transaction details + refund
│   │   ├── SettingsScreen.tsx           # Account settings
│   │   ├── TapToPaySettingsScreen.tsx   # Terminal reader management
│   │   ├── TapToPayEducationScreen.tsx  # TTPOi education flow
│   │   ├── UpgradeScreen.tsx            # Subscription upgrade
│   │   ├── EventsScannerScreen.tsx      # QR code scanner for event check-in
│   │   └── StripeOnboardingScreen.tsx   # Stripe Connect onboarding
│   ├── context/                         # State management (7 contexts)
│   │   ├── AuthContext.tsx              # Auth, user, org, subscription, biometric
│   │   ├── CartContext.tsx              # Cart with per-item notes
│   │   ├── CatalogContext.tsx           # Selected catalog + catalog list
│   │   ├── SocketContext.tsx            # Socket.IO connection + events
│   │   ├── StripeTerminalContext.tsx    # Terminal SDK, device compat, TTP
│   │   ├── ThemeContext.tsx             # Light/dark/system + alternate app icons
│   │   └── DeviceContext.tsx            # Persistent device ID tracking
│   ├── lib/
│   │   ├── api/                         # API service modules (12 files)
│   │   │   ├── client.ts               # HTTP client with token refresh
│   │   │   ├── auth.ts                 # Auth service
│   │   │   ├── catalogs.ts             # Catalog CRUD + duplicate
│   │   │   ├── products.ts             # Library + catalog products
│   │   │   ├── categories.ts           # Category management
│   │   │   ├── orders.ts               # Orders, held orders, payments
│   │   │   ├── transactions.ts         # Transaction history + refunds
│   │   │   ├── stripe-terminal.ts      # Terminal tokens, payment intents
│   │   │   ├── stripe-connect.ts       # Connect account status
│   │   │   ├── billing.ts              # Subscription info
│   │   │   ├── organizations.ts        # Organization details
│   │   │   └── index.ts                # Barrel export
│   │   ├── colors.ts                   # Dark/light theme color system + glass effects
│   │   ├── config.ts                   # Environment config
│   │   ├── device.ts                   # Device ID generation
│   │   ├── fonts.ts                    # Plus Jakarta Sans font declarations
│   │   ├── biometricAuth.ts            # Face ID / fingerprint auth
│   │   ├── iap.ts                      # In-app purchases
│   │   ├── logger.ts                   # Environment-aware logging
│   │   ├── auth-handoff.ts             # Cross-app auth token handoff
│   │   ├── session-callbacks.ts        # Session kicked callbacks
│   │   ├── stripe-terminal.ts          # Terminal SDK utilities
│   │   ├── animations.ts              # Reusable animation presets
│   │   ├── responsive.ts              # Responsive design helpers
│   │   ├── shadows.ts                 # Shadow presets
│   │   ├── spacing.ts                 # Spacing constants
│   │   ├── typography.ts              # Typography system
│   │   ├── validation.ts              # Input validation
│   │   └── native/
│   │       └── ProximityReaderDiscovery.ts  # NFC reader discovery
│   ├── components/                     # Reusable UI components (18)
│   │   ├── Input.tsx                   # Form input
│   │   ├── Toggle.tsx                  # Toggle switch
│   │   ├── ConfirmModal.tsx            # Confirmation dialog
│   │   ├── NetworkStatus.tsx           # Network awareness banner
│   │   ├── SetupPaymentsModal.tsx      # Payment setup wizard
│   │   ├── PaymentsDisabledBanner.tsx  # Payments not ready banner
│   │   ├── PayoutsSetupBanner.tsx      # Payouts setup prompt
│   │   ├── ProductModal.tsx            # Product add/edit
│   │   ├── CategoryManagerModal.tsx    # Category management
│   │   ├── CatalogSettingsModal.tsx    # Catalog settings editor
│   │   ├── ItemNotesModal.tsx          # Per-item special instructions
│   │   ├── ProfileEditModal.tsx        # Profile edit form
│   │   ├── SetupRequired.tsx           # Setup required screen
│   │   ├── SetupRequiredBanner.tsx     # Setup required banner
│   │   ├── TapToPayFirstUseModal.tsx   # First-use TTP education modal
│   │   ├── TapToPayEducationScreen.tsx # Full TTP education component
│   │   ├── SocketEventHandlers.tsx     # Socket event → query invalidation
│   │   └── DataPrefetcher.tsx          # Pre-load data on app start
│   ├── hooks/
│   │   ├── useTapToPayEducation.ts     # TTP education state management
│   │   └── index.ts                    # Barrel export
│   └── providers/
│       └── QueryProvider.tsx           # TanStack Query configuration
├── plugins/
│   └── withProximityReaderDiscovery.js # Expo plugin for NFC permissions
├── App.tsx                             # Root component + all navigation (877 lines)
├── app.config.ts                       # Expo config with entitlements + plugins
├── eas.json                            # EAS Build profiles (dev, prod)
├── package.json
├── tsconfig.json
└── index.ts                            # Entry point
```

---

## Navigation Structure

```
Root Navigator (native-stack)
├── Auth Stack (unauthenticated)
│   ├── LoginScreen
│   ├── ForgotPasswordScreen
│   └── ResetPasswordScreen
│
└── Authenticated Navigator (authenticated)
    ├── MainTabs (Bottom Tab Navigator - 3 tabs)
    │   ├── Menu Tab → MenuStackNavigator
    │   │   └── MenuScreen (product grid)
    │   ├── History Tab → HistoryStackNavigator
    │   │   ├── TransactionsScreen
    │   │   └── TransactionDetailScreen
    │   └── Settings Tab
    │       └── SettingsScreen
    │
    ├── Modal Screens
    │   ├── CatalogSelect (modal)
    │   ├── TapToPaySettings (card)
    │   ├── TapToPayEducation (modal)
    │   ├── Upgrade (card)
    │   ├── StripeOnboarding (modal)
    │   │
    │   └── Payment Flow (slide_from_bottom / fullScreenModal)
    │       ├── Checkout (modal)
    │       ├── PaymentProcessing (fullScreenModal)
    │       ├── PaymentResult (fullScreenModal)
    │       ├── CashPayment (modal)
    │       └── SplitPayment (modal)
```

---

## Single Session Enforcement (this app only)

**Single-session enforcement is rowie-app only.** A stolen or compromised phone running the POS must be kickable, so this client sends `X-Session-Version` on every request. The vendor web dashboard (rowie-vendor) intentionally does NOT participate — web users keep multiple tabs open and there's no security benefit to forcing one session there.

**How it works in this app:**
1. Login response includes `sessionVersion`. Store it via `authService.saveSessionVersion()`.
2. `lib/api/client.ts` reads it and sends as `X-Session-Version` header on every request.
3. If the API returns 401 with `code: 'SESSION_KICKED'`, the user has signed in elsewhere — log out and show the kick alert.
4. The Socket.IO `SESSION_KICKED` event fires too (real-time kick without waiting for the next API call).

If you ever see the audit say "vendor portal is missing X-Session-Version" — that's a false positive. The API middleware checks the header **only if it's present**, so omitting it cleanly opts out.

---

## Contexts & State Management

### AuthContext
```typescript
{
  user: User | null;
  organization: Organization | null;
  subscription: Subscription | null;        // tier, status, platform
  connectStatus: ConnectStatus | null;      // chargesEnabled, payoutsEnabled
  isPaymentReady: boolean;                  // Connect ready for payments
  biometricCapabilities: BiometricCapabilities;
  biometricEnabled: boolean;
  // Methods
  signIn(), signOut(), refreshAuth(),
  refreshConnectStatus(), setBiometricEnabled()
}
```

### CartContext
```typescript
{
  items: CartItem[];                        // product, quantity, notes, cartKey
  itemCount: number;
  subtotal: number;                         // In smallest currency unit
  orderNotes: string;                       // Order-level notes
  customerEmail: string;
  paymentMethod: 'tap_to_pay' | 'cash' | 'split';
  selectedTipIndex: number | null;
  customTipAmount: string;
  // Methods
  addItem(), removeItem(), updateQuantity(),
  updateItemNotes(), incrementItem(), decrementItem(), clearCart()
}
```

### StripeTerminalContext
```typescript
{
  isInitialized: boolean;
  isConnected: boolean;
  isProcessing: boolean;
  deviceCompatibility: DeviceCompatibility;  // Device TTP support check
  configurationStage: ConfigurationStage;    // idle → checking → initializing → ... → ready
  configurationProgress: number;             // 0-100%
  termsAcceptance: TermsAcceptanceStatus;
  // Methods
  initializeTerminal(), connectReader(),
  processPayment(), cancelPayment(),
  warmTerminal(), checkDeviceCompatibility()
}
```

### Other Contexts
- **CatalogContext** — Selected catalog, catalog list, Socket.IO event subscriptions
- **SocketContext** — Connection status, subscribe/emit, session verification, auto-reconnect
- **ThemeContext** — Light/dark/system theme, alternate app icons (iOS)
- **DeviceContext** — Persistent device UUID for order tracking

---

## Data Models

### Catalog
```typescript
interface Catalog {
  id: string;
  name: string;
  description?: string | null;
  location?: string | null;
  date?: string | null;
  productCount: number;
  isActive: boolean;
  showTipScreen: boolean;
  promptForEmail: boolean;
  tipPercentages: number[];       // e.g., [15, 18, 20, 25]
  allowCustomTip: boolean;
  taxRate: number;                // Decimal (e.g., 0.08)
  layoutType: 'grid' | 'list' | 'large-grid' | 'compact';
  isLocked?: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### Product
```typescript
interface Product {
  id: string;                     // catalog_product id
  productId: string;              // library product id
  catalogId: string;
  name: string;
  description?: string | null;
  price: number;                  // In smallest currency unit (cents for USD, yen for JPY)
  imageUrl?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
```

### CartItem
```typescript
interface CartItem {
  product: Product;
  quantity: number;
  notes?: string;                 // Per-item special instructions
  cartKey: string;                // Unique key: productId::notes_hash
}
```

### Order
```typescript
interface Order {
  id: string;
  orderNumber: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded' | 'held';
  paymentMethod: 'card' | 'cash' | 'tap_to_pay' | 'split' | null;
  subtotal: number;               // In cents
  taxAmount: number;
  tipAmount: number;
  totalAmount: number;
  stripePaymentIntentId?: string | null;
  customerEmail?: string | null;
  notes?: string | null;          // Order-level notes
  holdName?: string | null;       // Name for held orders
  heldAt?: string | null;
  heldBy?: string | null;
  deviceId?: string | null;       // Device that created the order
  items?: OrderItem[];
  createdAt: string;
  updatedAt: string;
}
```

### OrderPayment (Split Payments)
```typescript
interface OrderPayment {
  id: string;
  paymentMethod: 'card' | 'cash' | 'tap_to_pay';
  amount: number;                 // In smallest currency unit
  tipAmount: number;
  status: string;
  cashTendered?: number | null;
  cashChange?: number | null;
  stripePaymentIntentId?: string | null;
  createdAt?: string;
}
```

### Transaction
```typescript
interface Transaction {
  id: string;
  amount: number;                 // In smallest currency unit
  amountRefunded: number;
  status: 'succeeded' | 'pending' | 'failed' | 'refunded' | 'partially_refunded';
  customerEmail: string | null;
  paymentMethod: {
    brand: string | null;
    last4: string;
  } | null;
  created: number;                // Unix timestamp
  receiptUrl: string | null;
}
```

---

## Multi-Currency Support (MANDATORY)

Rowie supports multiple currencies per organization. The user's currency is available via `useAuth()`. Zero-decimal currencies (JPY, KRW, VND, etc.) have no fractional units — amounts are whole numbers with no cents.

### Currency Utility Functions (`src/utils/currency.ts`)

| Function | Purpose | Example |
|----------|---------|---------|
| `isZeroDecimal(currency)` | Check if currency has no subunits | `isZeroDecimal('jpy') → true` |
| `fromSmallestUnit(amount, currency)` | Stripe unit → base unit | USD: `1099 → 10.99`, JPY: `1099 → 1099` |
| `toSmallestUnit(amount, currency)` | Base unit → Stripe unit | USD: `10.99 → 1099`, JPY: `1099 → 1099` |
| `formatCurrency(amount, currency)` | Format base-unit amount | `formatCurrency(10.99, 'usd') → "$10.99"` |
| `formatCents(cents, currency)` | Format smallest-unit amount | `formatCents(1099, 'usd') → "$10.99"` |
| `getCurrencySymbol(currency)` | Get symbol string | `getCurrencySymbol('eur') → "€"` |

### Getting the Currency

```typescript
const { currency } = useAuth(); // From AuthContext — e.g. 'usd', 'jpy', 'eur'
```

### Rules

1. **NEVER** use raw `/ 100` or `* 100` for currency conversions — always use `fromSmallestUnit()` / `toSmallestUnit()`
2. **NEVER** hardcode `"$"` — always use `getCurrencySymbol(currency)`
3. **NEVER** use `.toFixed(2)` on monetary amounts without checking `isZeroDecimal(currency)` first — zero-decimal currencies should use `.toFixed(0)`
4. **NEVER** block the decimal `.` key unconditionally in numeric keypads — for zero-decimal currencies, the decimal key should be disabled
5. **ALWAYS** pass `currency` to all `formatCurrency()` and `formatCents()` calls — never rely on the `'usd'` default

### Pattern — Screen with Currency

```typescript
import { useAuth } from '../context/AuthContext';
import { formatCents, getCurrencySymbol, isZeroDecimal, fromSmallestUnit } from '../utils/currency';

const MyScreen = () => {
  const { currency } = useAuth();

  // Display a smallest-unit amount (from cart/API):
  const display = formatCents(totalAmountCents, currency);

  // Display a currency symbol:
  const symbol = getCurrencySymbol(currency);

  // Convert for API calls:
  const baseAmount = fromSmallestUnit(cents, currency);
};
```

### Note on Hermes Runtime

React Native's Hermes engine has limited `Intl.formatToParts` support. The App uses a `CURRENCY_SYMBOLS` lookup table in `currency.ts` for reliable symbol resolution, unlike the API/Vendor which use `Intl.NumberFormat` directly.

---

## Payment Flows

### Tap to Pay (Stripe Terminal)
```typescript
// 1. Get connection token from API
const { secret } = await stripeTerminalApi.getConnectionToken();

// 2. Initialize Terminal SDK
await initStripeTerminal({ fetchConnectionToken: async () => secret });

// 3. Discover local mobile reader (phone's NFC)
const { readers } = await discoverReaders({
  discoveryMethod: DiscoveryMethod.LocalMobile,
});

// 4. Connect to reader
await connectLocalMobileReader({ reader: readers[0] });

// 5. Create PaymentIntent via API
const { clientSecret, paymentIntentId } = await stripeTerminalApi.createPaymentIntent({
  amount: totalAmount,
  catalogId,
  items,
  tipAmount,
  customerEmail,
});

// 6. Collect payment (shows Tap to Pay UI)
const { paymentIntent: collected } = await collectPaymentMethod({ paymentIntent });

// 7. Confirm payment
const { paymentIntent: confirmed } = await confirmPaymentIntent({ paymentIntent: collected });

// 8. Send receipt if email provided
if (customerEmail) {
  await stripeTerminalApi.sendReceipt(paymentIntentId, customerEmail);
}
```

### Cash Payment
- Numeric keypad with quick amount buttons ($1, $5, $10, $20, $50, $100)
- Auto-calculates change due
- Creates order with `paymentMethod: 'cash'`

### Split Payment
- Add multiple payments across Tap to Pay, Cash, or Card
- Tracks remaining balance
- Each payment recorded as an `OrderPayment`
- Order completed when total covered

### Held Orders
- Save incomplete orders with a name
- Device-specific tracking via `deviceId`
- Recall and complete later
- Swipe-to-delete gesture support

---

## TanStack Query Configuration

```typescript
defaultOptions: {
  queries: {
    staleTime: 30 * 1000,            // 30 seconds
    gcTime: 30 * 60 * 1000,          // 30 minutes cache
    refetchOnWindowFocus: true,       // Refetch on app foreground
    refetchOnMount: false,            // Socket handles updates
    refetchOnReconnect: true,         // Refetch on network reconnect
    retry: 1,                         // Retry once on failure
  }
}
```

---

## Socket.IO Events

```typescript
const SocketEvents = {
  // User events
  USER_UPDATED: 'user:updated',
  ORGANIZATION_UPDATED: 'organization:updated',
  SESSION_KICKED: 'session:kicked',
  SUBSCRIPTION_UPDATED: 'subscription:updated',

  // Catalog events
  CATALOG_UPDATED: 'catalog:updated',
  CATALOG_CREATED: 'catalog:created',
  CATALOG_DELETED: 'catalog:deleted',

  // Product events
  PRODUCT_UPDATED: 'product:updated',
  PRODUCT_CREATED: 'product:created',
  PRODUCT_DELETED: 'product:deleted',

  // Category events
  CATEGORY_UPDATED: 'category:updated',
  CATEGORY_CREATED: 'category:created',
  CATEGORY_DELETED: 'category:deleted',
  CATEGORIES_REORDERED: 'categories:reordered',

  // Order events
  ORDER_CREATED: 'order:created',
  ORDER_UPDATED: 'order:updated',
  ORDER_COMPLETED: 'order:completed',
  ORDER_FAILED: 'order:failed',
  ORDER_DELETED: 'order:deleted',
  ORDER_REFUNDED: 'order:refunded',

  // Transaction events
  TRANSACTION_CREATED: 'transaction:created',
  TRANSACTION_UPDATED: 'transaction:updated',
  PAYMENT_RECEIVED: 'payment:received',
};
```

---

## API Endpoints Used

### Authentication
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/auth/login` | User login |
| POST | `/auth/signup` | Registration |
| POST | `/auth/refresh` | Token refresh |
| POST | `/auth/logout` | Logout |
| GET | `/auth/me` | Get profile |
| PATCH | `/auth/profile` | Update profile |
| POST | `/auth/avatar` | Upload avatar |
| POST | `/auth/forgot-password` | Request password reset |
| POST | `/auth/reset-password` | Complete password reset |

### Catalogs & Products
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/catalogs` | List catalogs |
| GET | `/catalogs/{id}` | Get catalog |
| POST | `/catalogs/{id}/duplicate` | Duplicate catalog |
| GET | `/catalogs/{id}/products` | Get products |
| GET | `/catalogs/{id}/categories` | Get categories |
| GET | `/products` | Library products (org-level) |

### Orders & Payments
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/orders` | Create order |
| GET | `/orders/{id}` | Get order |
| PATCH | `/orders/{id}` | Update order |
| POST | `/orders/{id}/hold` | Hold order |
| POST | `/orders/{id}/payments` | Add payment (split) |
| POST | `/orders/{id}/complete` | Complete order |
| POST | `/orders/{id}/refund` | Refund order |
| GET | `/orders/held` | Get held orders |
| POST | `/stripe/terminal/connection-token` | Get Terminal token |
| POST | `/stripe/terminal/payment-intent` | Create PaymentIntent |
| POST | `/stripe/terminal/payment-intent/{id}/send-receipt` | Send receipt |
| POST | `/stripe/terminal/payment-intent/{id}/simulate` | Test simulation |

### Transactions
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/stripe/connect/transactions` | List transactions |
| POST | `/orders/{id}/refund` | Refund order |

### Stripe Connect
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/stripe/connect/status` | Connect account status |

### Billing & Organization
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/billing` | Subscription info |
| GET | `/organizations` | Organization details |

---

## Design System

### Colors (`/src/lib/colors.ts`)

**Dark Theme (default):**
```typescript
background: '#1C1917',      // stone-900 — NEVER use pure #000000
card: '#292524',             // stone-800
cardHover: '#44403C',        // stone-700
border: '#44403C',           // stone-700
text: '#F5F5F4',             // stone-100
textSecondary: '#A8A29E',   // stone-400
textMuted: '#78716C',        // stone-500
primary: '#F59E0B',          // amber-500
primaryLight: '#FBBF24',     // amber-400
success: '#22C55E',
error: '#EF4444',
warning: '#F59E0B',
tabActive: '#F59E0B',        // Active tab indicator
```

**IMPORTANT:** Never use pure `#000000` black for backgrounds. Always use `#1C1917` (stone-900) or `#0C0A09` (stone-950). The only exceptions are phone bezel mockups and QR code colors. This matches the amber/stone palette used across all Rowie repos.

**Light Theme:**
```typescript
background: '#FAFAF9',
card: '#FFFFFF',
text: '#1C1917',
textSecondary: '#78716C',
```

**Glass Effects:** Glassmorphic overlays and borders for modals

### Typography
- **Font:** Plus Jakarta Sans (400, 500, 600, 700, 800)
- Loaded via `@expo-google-fonts/plus-jakarta-sans`

---

## Build Configuration

### EAS Build (`eas.json`)
- **dev:** TestFlight/internal distribution, dev API endpoints
- **prod:** Auto-increment version, production API endpoints

### App Config (`app.config.ts`)
- **App Name:** "Rowie" (prod) / "Rowie (env)" (dev/local)
- **Version:** 1.0.1
- **Scheme:** `rowie`
- **Bundle ID:** `com.rowie.app`
- **Orientation:** Portrait only
- **iOS Deployment Target:** 16.4+ (required for Tap to Pay)
- **Android minSdkVersion:** 26 (required for Stripe Terminal)

### Plugins
- `expo-font` — Font loading
- `./plugins/withProximityReaderDiscovery` — NFC/Proximity Reader permissions
- `expo-alternate-app-icons` — App icon switching (light/dark)
- `expo-build-properties` — Native build configuration
- `@stripe/stripe-react-native` — Stripe SDK integration

### Build Commands
```bash
# Development
npm run dev                              # Expo dev server at port 3336

# Platform-specific
npm run android                          # Run on Android
npm run ios                              # Run on iOS

# EAS Builds
npm run build:dev                        # Android dev build
npm run build:dev:ios                    # iOS dev build + auto-submit
npm run build:prod                       # Android production build
npm run submit:ios                       # Submit to App Store
```

---

## Environment Variables

```bash
# .env / .env.example
EXPO_PUBLIC_APP_ENV=local                # local | dev | prod
EXPO_PUBLIC_API_URL=http://localhost:4334
EXPO_PUBLIC_WEBSITE_URL=https://rowie.io
EXPO_PUBLIC_VENDOR_DASHBOARD_URL=https://portal.rowie.io
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
```

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Tap to Pay** | Stripe Terminal SDK for contactless NFC payments |
| **Cash Payments** | Numeric keypad, quick amounts, change calculation |
| **Split Payments** | Split across multiple payment methods |
| **Held Orders** | Save orders to complete later, device-specific |
| **Per-Item Notes** | Special instructions per cart item |
| **Biometric Login** | Face ID / Fingerprint authentication |
| **Theme Switching** | Light/dark/system with alternate iOS app icons |
| **Real-time Sync** | Socket.IO driven data updates |
| **TTP Education** | Apple-compliant Tap to Pay onboarding screens |
| **Device Tracking** | Persistent device ID for order attribution |
| **Network Awareness** | Connection status monitoring |
| **Data Prefetching** | Pre-load menu, settings, transactions on app start |

---

## Debugging

### Android Logs (PowerShell)
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat *:S ReactNative:V ReactNativeJS:V
```

### Logger Utility
- `lib/logger.ts` — Environment-aware logging (suppressed in production)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| minSdkVersion error | Ensure `expo-build-properties` plugin sets `minSdkVersion: 26` |
| Stripe Terminal not working | Must use development build, not Expo Go |
| NFC not detecting | Check device NFC is enabled, try different card angle |
| Token refresh loop | Clear secure storage, re-login |
| Socket not connecting | Verify API URL, check auth token validity |
| Biometric not available | Check device capabilities and permissions |
| Theme not persisting | Check AsyncStorage access |
| Held orders not showing | Verify device ID is being sent with requests |
| Tap to Pay blocked / "merchant blocked" after testing | Stripe/Apple limits a device to ~3 Stripe Connect account sessions for Tap to Pay. After linking to too many accounts (e.g. repeatedly creating test accounts), the device gets blocked. This is NOT a code bug — it's an anti-fraud measure. You must use a different physical device or contact Stripe support to reset. |

---

## Security Notes

- Tokens stored in `expo-secure-store` (encrypted native storage)
- Biometric auth gated by device capability check
- All API calls use HTTPS in production
- Sensitive data not logged in production builds
- Payment data handled entirely by Stripe SDK (PCI compliant)
- Session version validated on every API request
- Device passcode required for Tap to Pay

---

## Code Review & Quality Enforcement

All implementations will be reviewed by Codex. The following standards are enforced:

### Code Standards
- **TypeScript strict mode** — no `any` types unless explicitly justified
- **Consistent naming** — camelCase for variables/functions, PascalCase for components/types, UPPER_SNAKE_CASE for constants
- **No dead code** — unused imports, variables, components, or commented-out blocks must be removed
- **Error handling** — all async operations must have proper try/catch with user-facing error messages
- **Accessibility** — VoiceOver support required for all Tap to Pay flows, Dynamic Type support, adequate color contrast
- **Security** — no sensitive data in logs, payment data handled exclusively by Stripe SDK, session version validated

### Functionality Checks
- **All code paths tested** — happy path, error cases, offline states, and edge cases must be verified
- **API contracts honored** — request/response shapes must match the API's TypeScript types
- **Payment flow integrity** — full Stripe Terminal flow must be tested end-to-end in test mode
- **Real-time consistency** — Socket.IO event handlers must cover all events the backend emits
- **Apple TTPOi compliance** — all Tap to Pay flows must meet Apple's requirements (Section 2-6)
- **Platform compatibility** — must work on both iOS (XS+, iOS 16.4+) and Android (SDK 26+)

### Review Process
- Codex will flag violations of these standards during review
- PRs with unresolved violations will not be approved
- When in doubt, prefer explicit over clever — readability and correctness over brevity

---

**Remember:** This is a financial application handling real payments. Test thoroughly in Stripe test mode before any production deployment. Ensure Apple TTPOi compliance for App Store approval.
