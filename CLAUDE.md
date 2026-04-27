# rowie-app — Mobile POS

> See the root [CLAUDE.md](../CLAUDE.md) for cross-repo rules, design tokens, and code-review standards.

React Native POS for mobile bars, food trucks, restaurants, events. Contactless payments via Stripe Tap to Pay on iPhone/Android, plus cash, split, and **bar tabs (SetupIntent)**. Also drives **table sessions** (floor plans + table-side ordering) and customer-facing QR entry.

**Stack:** RN 0.81.5 · Expo SDK 54 · TS 5.9 strict · React Navigation v7 (native-stack + bottom-tabs) · React Context (8, +LanguageContext) + TanStack Query v5 · Stripe RN + Stripe Terminal (Tap to Pay + `readReusableCard` for tabs) + Cash + Split · Socket.IO 4.8 · expo-secure-store (tokens) + AsyncStorage (prefs) · Biometric auth (Face ID / Fingerprint) + email/password · Plus Jakarta Sans · react-native-iap 14.7 · 12-language i18n via `LanguageContext` + `/src/messages/*.json`

---

## Apple Tap to Pay Compliance (CRITICAL)

Must comply with Apple TTPOi v1.5 (March 2025). See root CLAUDE.md for the summary; full details below.

### Device Requirements
- **iPhone:** XS+ (A12 Bionic+), iOS 16.4+
- **Android:** NFC-capable, Android 8.0 (SDK 26)+
- **Passcode:** enabled on device

### Entitlements
1. **Development Entitlement** — Apple Developer portal, 1–2 days to approve, required for TestFlight.
2. **Publishing Entitlement** — required before App Store submission, separate request after dev testing.

### iOS Entitlements (`app.config.ts`)
- `com.apple.developer.proximity-reader.payment.acceptance` — Tap to Pay
- `com.apple.developer.in-app-payments` — In-app payments

### UX Requirements (Apple-mandated)

**Onboarding (§2.1–2.3):** `TapToPayEducationScreen` + `TapToPayFirstUseModal` educate merchants before first use — supported cards (Visa, MC, Amex, Discover), device compatibility, how contactless works.

**Checkout (§3.1–3.5):** clear total before payment; payment sheet shows amount; immediate success/failure via `PaymentResultScreen`; receipt offering (email) after success.

**Error Handling (§4.1–4.3):** clear messages; retry for transient; guidance for persistent; never expose technical codes.

### Dynamic Type / Accessibility (§4.4 — MANDATORY)

Every `<Text>` MUST have `maxFontSizeMultiplier`. RN's default `allowFontScaling={true}` scales with Dynamic Type, so caps prevent overflow at extreme sizes.

| Font size | Context | `maxFontSizeMultiplier` |
|-----------|---------|-------------------------|
| ≥24 | Amounts, large numbers | `1.2` |
| 17–23 | Titles, headings | `1.3` |
| ≤16 inside buttons/touchables | | `1.3` |
| ≤16 body text/labels | | `1.5` |

```tsx
<Text style={styles.amount} maxFontSizeMultiplier={1.2}>$4.50</Text>
<Text style={styles.title} maxFontSizeMultiplier={1.3}>Payment Settings</Text>
<Text style={styles.buttonText} maxFontSizeMultiplier={1.3}>Submit</Text>
<Text style={styles.description} maxFontSizeMultiplier={1.5}>Enter your details</Text>
```

Use `minHeight` instead of fixed `height` on text containers so they expand when text scales.

### VoiceOver / Accessibility Labels (§4.4 — MANDATORY)

Every interactive element MUST have accessibility props. Required for App Store approval.

```tsx
// Buttons
<TouchableOpacity accessibilityRole="button" accessibilityLabel="Pay with Tap to Pay">

// Inputs
<TextInput accessibilityLabel="Email address" />

// Toggles
<TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: isEnabled }}>

// Links (external nav)
<TouchableOpacity accessibilityRole="link" accessibilityLabel="Open Vendor Portal">

// Alerts
<View accessibilityRole="alert"><Text>Payment failed</Text></View>

// Loading / Images / Modal close buttons
<ActivityIndicator accessibilityLabel="Loading" />
<Image accessibilityLabel="Rowie logo" />
<TouchableOpacity accessibilityRole="button" accessibilityLabel="Close">

// Dynamic labels
<TouchableOpacity accessibilityLabel={`Refund $${amount} transaction`}>
```

- **`accessibilityHint`:** only when the action isn't obvious from the label (e.g., `"Double tap to process payment"`).
- **Do NOT label:** decorative elements (gradients, dividers, spacers).

### Mobile-Friendly UI (MANDATORY)

**Layout:**
- `flexDirection: 'row'` + `flexWrap: 'wrap'` or `flex: 1` to prevent horizontal overflow.
- `marginHorizontal`/`paddingHorizontal` ≥16px from screen edges.
- No fixed widths that overflow on iPhone SE (320pt).
- Percentage widths or `flex` for responsive sizing.

**Touch targets:**
- Minimum 44×44pt (iOS HIG) / 48×48dp (Material).
- `hitSlop` to expand tap areas on small icons without increasing visual size.
- `gap: 8–12` between adjacent tappables.

**Text & inputs:**
- All `<Text>` has `maxFontSizeMultiplier` (above).
- `minHeight` not fixed `height` on text containers.
- `<TextInput>` wrapped in `KeyboardAvoidingView` (`'padding'` iOS, `'height'` Android).
- `keyboardShouldPersistTaps="handled"` on scroll views with inputs.

**Feedback:**
- Disabled buttons visually distinct (reduced opacity / muted colors).
- Loading states use `ActivityIndicator` with `accessibilityLabel`.
- Error/warning/success via banners or indicators — never alerts alone.
- Form validation errors inline near the input.

**Safe areas:**
- `SafeAreaView` from `react-native-safe-area-context` (not RN's built-in).
- Explicit `edges={['top', 'bottom', 'left', 'right']}`.
- Bottom-padded footers account for home indicator on modern iPhones.

### Marketing (§5.1–5.3)
Official Apple Tap to Pay branding assets; trademark guidelines; required disclaimers.

### Pre-Submission Checklist
- [ ] Dev entitlement approved
- [ ] Merchant onboarding flow
- [ ] TTP education screens
- [ ] Clear amount display before payment
- [ ] Success/failure feedback
- [ ] Receipt offering
- [ ] User-friendly error messages
- [ ] VoiceOver tested
- [ ] Publishing entitlement requested
- [ ] Marketing uses approved assets

---

## React Performance Patterns (MANDATORY)

### 1. Socket handlers — NEVER inline `useCallback` inside `useSocketEvent()`
`useSocketEvent(event, callback)` subscribes/unsubscribes via `useEffect` whenever the callback ref changes. Inline `useCallback` creates a new reference per dep change → subscribe/unsubscribe loop → crash.

```tsx
// BAD
useSocketEvent(SocketEvents.ORDER_UPDATED, useCallback((data) => {
  if (data.catalogId === selectedCatalogId) refreshOrders();
}, [refreshOrders]));

// GOOD — define handler outside, pass stable ref
const handleOrderUpdated = useCallback((data) => {
  if (data.catalogId === selectedCatalogId) refreshOrders();
}, [refreshOrders]);
useSocketEvent(SocketEvents.ORDER_UPDATED, handleOrderUpdated);
```

Also NEVER include derived/changing values (`orders.length`, `items.length`) in socket handler deps — recreates on every data change → re-subscription loop.

### 2. Context providers — ALWAYS memoize `value` with `useMemo`

```tsx
// BAD — new object every render, all consumers re-render
<MyContext.Provider value={{ data, loading, refresh }}>

// GOOD
const value = useMemo(() => ({ data, loading, refresh }), [data, loading, refresh]);
<MyContext.Provider value={value}>
```

All 8 providers (Auth, Cart, Catalog, Socket, StripeTerminal, Theme, Preorders, Device) follow this.

### 3. List item components — ALWAYS wrap with `memo()`
Components in `FlatList`, `SectionList`, or `.map()` loops:
```tsx
const TransactionItem = memo(function TransactionItem({ item, onPress }) { ... });
```
Currently memoized: `AnimatedTransactionItem`, `CategoryPill`, `KeypadButton`.

### 4. No redundant fetching in socket handlers
If `CatalogContext` handles `refreshCatalogs()` on `CATALOG_UPDATED`, individual screens must NOT also call it. Screens only refetch screen-specific data (products, categories).

### 5. Functional setState to avoid stale closures
```tsx
// BAD — depends on state.user, recreates callback on every user change
const completeOnboarding = useCallback(async () => {
  setState({ ...state, user: { ...state.user, onboardingCompleted: true } });
}, [state.user]);

// GOOD — no state dep, stable callback
const completeOnboarding = useCallback(async () => {
  setState(prev => ({
    ...prev,
    user: prev.user ? { ...prev.user, onboardingCompleted: true } : null,
  }));
}, []);
```

### 6. Rules of Hooks — NEVER call conditionally or after early returns
All hooks (built-in + custom `useTheme`, `useSocketEvent`, etc.) at the top level BEFORE any conditional `return`. React tracks hooks by call order — skipping one on a render crashes.

```tsx
// BAD — useMemo after early return
if (!isLoaded) return null;
const value = useMemo(() => ({ theme, isDark }), [theme, isDark]);

// GOOD
const value = useMemo(() => ({ theme, isDark }), [theme, isDark]);
if (!isLoaded) return null;
```

Never call hooks inside `if`, loops, ternaries, `switch`, `&&`/`||`.

---

## Directory Structure

```
rowie-app/
├── src/
│   ├── screens/   # 26 screens
│   │   # Auth + Onboarding
│   │   Login, SignUp, ForgotPassword, ResetPassword, StripeOnboarding
│   │   # Catalog + Cart
│   │   CatalogSelect (modal), Menu, Cart, Checkout
│   │   # Location
│   │   LocationPicker                    # NEW — pick location for POS (multi-venue)
│   │   # Payments
│   │   PaymentProcessing (fullscreen), PaymentResult (fullscreen),
│   │   CashPayment, SplitPayment
│   │   # Sessions / Tables / Tabs (NEW)
│   │   FloorPlan                         # Floor plan view: tables + active sessions
│   │   SessionDetail                     # Session detail (items, rounds, per-item status)
│   │   AddItemsToSession                 # Add new round of items to a session
│   │   Tabs                              # List open tabs (payment_type='tab')
│   │   OpenTab                           # Open a new tab (Terminal readReusableCard → SetupIntent)
│   │   # Transactions / History
│   │   Transactions, TransactionDetail
│   │   # Settings / Devices
│   │   Settings, TapToPaySettings, TapToPayEducation, ReaderManagement, Upgrade
│   │   # Events
│   │   EventsScanner
│   ├── context/   # 8 contexts
│   │   AuthContext         — auth, user, org, subscription, biometric, currency
│   │   CartContext         — cart with per-item notes
│   │   CatalogContext      — selected catalog + list + socket subs
│   │   SocketContext       — connection, subscribe/emit, session verify, auto-reconnect
│   │   StripeTerminalContext — SDK, device compat, TTP, readReusableCard for tabs
│   │   ThemeContext        — light/dark/system, alternate iOS app icons
│   │   DeviceContext       — persistent device UUID
│   │   LanguageContext     — NEW — 12-language i18n + currency locale
│   ├── lib/
│   │   ├── api/            # 15 files: client (w/ refresh), auth, catalogs, products,
│   │   │                   #          categories, orders, transactions, stripe-terminal,
│   │   │                   #          stripe-connect, billing, organizations, index,
│   │   │                   #          sessions (+ floorPlansApi + tabs), preorders (compat shim),
│   │   │                   #          events
│   │   ├── colors.ts       # Dark/light tokens + glass effects
│   │   ├── config.ts, device.ts, fonts.ts
│   │   ├── biometricAuth.ts, iap.ts, logger.ts
│   │   ├── auth-handoff.ts, session-callbacks.ts, stripe-terminal.ts
│   │   ├── animations.ts, responsive.ts, shadows.ts, spacing.ts, typography.ts, validation.ts
│   │   └── native/ProximityReaderDiscovery.ts
│   ├── messages/           # 12 locale JSON files (en, es, fr, de, it, nl, pt, sv, da, no, fi, cs)
│   ├── components/  # ~29 components
│   │   Input, Toggle, ConfirmModal, NetworkStatus,
│   │   SetupPaymentsModal, PaymentsDisabledBanner, PayoutsSetupBanner,
│   │   ProductModal, CategoryManagerModal, CatalogSettingsModal,
│   │   ItemNotesModal, ProfileEditModal,
│   │   SetupRequired, SetupRequiredBanner,
│   │   TapToPayFirstUseModal, TapToPayEducationScreen,
│   │   SocketEventHandlers, DataPrefetcher,
│   │   LanguagePickerModal, QuickChargeBottomSheet, ErrorBoundary,
│   │   EmptyState,
│   │   ui/ → FloatingTabBar, GradientButton, GradientAccent, ScreenHeader, Card, Chip,
│   │          EmptyState, SectionHeader
│   ├── hooks/useTapToPayEducation.ts
│   └── providers/QueryProvider.tsx
├── plugins/withProximityReaderDiscovery.js  # Expo plugin for NFC permissions
├── App.tsx                                  # Root + all navigation
├── app.config.ts                            # Expo config w/ entitlements
├── eas.json                                 # Build profiles
└── index.ts
```

---

## Navigation

```
Root (native-stack)
├── Auth Stack (unauthenticated)
│   └── Login, SignUp, ForgotPassword, ResetPassword
└── Authenticated
    ├── MainTabs (bottom tabs)
    │   ├── Menu / FloorPlan
    │   ├── Tabs (open tabs list)
    │   ├── History (Transactions, TransactionDetail)
    │   └── Settings
    └── Modal Screens
        CatalogSelect, LocationPicker, TapToPaySettings, TapToPayEducation,
        ReaderManagement, Upgrade, StripeOnboarding, LanguagePickerModal
        Session flow: SessionDetail, AddItemsToSession, OpenTab
        Payment flow: Checkout, PaymentProcessing (fullscreen), PaymentResult (fullscreen),
                      CashPayment, SplitPayment, QuickChargeBottomSheet
```

---

## Single Session Enforcement (this app only)

Mobile-only by design — stolen phone running POS must be kickable. Vendor web dashboard intentionally opts out (multiple tabs support; no direct card payment handling there).

**Flow in this app:**
1. Login response includes `sessionVersion` → `authService.saveSessionVersion()`.
2. `lib/api/client.ts` sends it as `X-Session-Version` on every request.
3. 401 + `code: 'SESSION_KICKED'` → log out, show kick alert.
4. Socket.IO `SESSION_KICKED` event fires in parallel (real-time kick).

If an audit says "vendor portal missing X-Session-Version" → false positive. The API middleware only checks the header when present.

---

## Contexts (shape summary)

### AuthContext
```ts
{
  user: User | null;
  organization: Organization | null;
  subscription: Subscription | null;    // tier, status, platform
  connectStatus: ConnectStatus | null;  // chargesEnabled, payoutsEnabled
  isPaymentReady: boolean;
  biometricCapabilities, biometricEnabled;
  signIn(), signOut(), refreshAuth(),
  refreshConnectStatus(), setBiometricEnabled()
}
```

### CartContext
```ts
{
  items: CartItem[];                // product, quantity, notes, cartKey
  itemCount: number; subtotal: number;  // smallest unit
  orderNotes: string; customerEmail: string;
  paymentMethod: 'tap_to_pay' | 'cash' | 'split';
  selectedTipIndex: number | null; customTipAmount: string;
  addItem(), removeItem(), updateQuantity(),
  updateItemNotes(), incrementItem(), decrementItem(), clearCart()
}
```

### StripeTerminalContext
```ts
{
  isInitialized, isConnected, isProcessing;
  deviceCompatibility;           // TTP support check
  configurationStage;            // idle → checking → initializing → … → ready
  configurationProgress: number; // 0–100
  termsAcceptance;
  initializeTerminal(), connectReader(),
  processPayment(), cancelPayment(),
  warmTerminal(), checkDeviceCompatibility()
}
```

**Others:** CatalogContext (selected + list + socket subs), SocketContext (connection, subscribe/emit, session verify, auto-reconnect), ThemeContext (light/dark/system + alternate iOS app icons), DeviceContext (persistent UUID).

---

## Data Models

```ts
interface Catalog {
  id; name; description?; location?; date?;
  productCount; isActive;
  showTipScreen; promptForEmail;
  tipPercentages: number[];  // [15,18,20,25]
  allowCustomTip; taxRate: number;  // decimal (0.08)
  layoutType: 'grid' | 'list' | 'large-grid' | 'compact';
  isLocked?; createdAt; updatedAt;
}

interface Product {
  id;          // catalog_product id
  productId;   // library product id
  catalogId; name; description?;
  price: number;  // smallest unit (cents / yen)
  imageUrl?; categoryId?; categoryName?;
  isActive; sortOrder; createdAt; updatedAt;
}

interface CartItem {
  product: Product; quantity: number;
  notes?: string;
  cartKey: string;  // unique: productId::notes_hash
}

interface Order {
  id; orderNumber;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded' | 'held';
  paymentMethod: 'card' | 'cash' | 'tap_to_pay' | 'split' | null;
  subtotal; taxAmount; tipAmount; totalAmount;  // cents
  stripePaymentIntentId?; customerEmail?;
  notes?;                    // order-level
  holdName?; heldAt?; heldBy?;
  deviceId?; items?: OrderItem[];
  createdAt; updatedAt;
}

interface OrderPayment {
  id; paymentMethod: 'card' | 'cash' | 'tap_to_pay';
  amount; tipAmount;          // smallest unit
  status;
  cashTendered?; cashChange?;
  stripePaymentIntentId?; createdAt?;
}

interface Transaction {
  id; amount; amountRefunded;   // smallest unit
  status: 'succeeded' | 'pending' | 'failed' | 'refunded' | 'partially_refunded';
  customerEmail: string | null;
  paymentMethod: { brand: string | null; last4: string } | null;
  created: number;              // unix ts
  receiptUrl: string | null;
}
```

---

## Multi-Currency Support (MANDATORY)

Org currency via `useAuth()`. Zero-decimal currencies (JPY, KRW, VND) have no fractional units.

### Utilities (`src/utils/currency.ts`)
| Function | Example |
|----------|---------|
| `isZeroDecimal(currency)` | `'jpy' → true` |
| `fromSmallestUnit(amount, currency)` | USD: `1099 → 10.99`; JPY: `1099 → 1099` |
| `toSmallestUnit(amount, currency)` | USD: `10.99 → 1099`; JPY: `1099 → 1099` |
| `formatCurrency(amount, currency)` | `(10.99, 'usd') → "$10.99"` |
| `formatCents(cents, currency)` | `(1099, 'usd') → "$10.99"` |
| `getCurrencySymbol(currency)` | `'eur' → "€"` |

```ts
const { currency } = useAuth();  // 'usd', 'jpy', 'eur', …
```

### Rules
1. NEVER raw `/100` or `*100` — use the utils.
2. NEVER hardcode `"$"` — use `getCurrencySymbol(currency)`.
3. NEVER `.toFixed(2)` without `isZeroDecimal(currency)` first — zero-decimal uses `.toFixed(0)`.
4. NEVER unconditionally block the `.` key on numeric keypads — disable it for zero-decimal.
5. ALWAYS pass `currency` to `formatCurrency()` / `formatCents()` — never rely on `'usd'` default.

```ts
const MyScreen = () => {
  const { currency } = useAuth();
  const display = formatCents(totalAmountCents, currency);
  const symbol = getCurrencySymbol(currency);
  const baseAmount = fromSmallestUnit(cents, currency);
};
```

**Hermes note:** limited `Intl.formatToParts` support. The app uses a `CURRENCY_SYMBOLS` lookup table in `currency.ts` (unlike API/Vendor which use `Intl.NumberFormat` directly).

---

## Payment Flows

### Tap to Pay (Stripe Terminal)
```ts
const { secret } = await stripeTerminalApi.getConnectionToken();
await initStripeTerminal({ fetchConnectionToken: async () => secret });
const { readers } = await discoverReaders({ discoveryMethod: DiscoveryMethod.LocalMobile });
await connectLocalMobileReader({ reader: readers[0] });
const { clientSecret, paymentIntentId } = await stripeTerminalApi.createPaymentIntent({
  amount: totalAmount, catalogId, items, tipAmount, customerEmail,
});
const { paymentIntent: collected } = await collectPaymentMethod({ paymentIntent });
const { paymentIntent: confirmed } = await confirmPaymentIntent({ paymentIntent: collected });
if (customerEmail) await stripeTerminalApi.sendReceipt(paymentIntentId, customerEmail);
```

### Cash
Numeric keypad + quick amounts ($1/$5/$10/$20/$50/$100), auto-calculates change, order `paymentMethod: 'cash'`.

### Split
Multiple payments across Tap to Pay / Cash / Card. Tracks remaining balance; each recorded as `OrderPayment`; order completes when total covered.

### Held Orders
Save incomplete orders with a name. Device-specific via `deviceId`. Recall later. Swipe-to-delete supported.

---

## Sessions, Tables & Tabs

Replaces preorders as the unified model. `preorders.ts` exists only as a backward-compat shim used by `TransactionDetailScreen` for legacy display — do NOT call it from new screens.

### Floor Plan → Table → Session
```
FloorPlanScreen → floorPlansApi.list() / .get(id) → shows tables + active sessions
    ↓ tap table
  → If no open session: sessionsApi.create({ source: 'pos', tableId, catalogId })
  → If open session: SessionDetailScreen → sessionsApi.get(id)
    ↓ add items
    AddItemsToSessionScreen → sessionsApi.addItems(id, items) → new round
    ↓ settle
    CheckoutScreen path → sessionsApi.settle(id, { paymentType })
```

### Tabs (payment_type='tab')
A tab IS a session with a saved Stripe PaymentMethod.

```ts
// Open a tab:
// 1. Terminal readReusableCard() → PaymentMethod on connected account
// 2. Create SetupIntent referencing the payment method
// 3. sessionsApi.openTab(sessionId, { stripeSetupIntentId, stripePaymentMethodId })

// Add items while tab is open:
await sessionsApi.addItems(sessionId, items);

// Close tab (charge full amount):
await sessionsApi.closeTab(sessionId);  // API creates PI with saved PM, confirms
```

`TabsScreen` lists open tabs via `sessionsApi.listTabs()`.

### Checkout → Session Integration (deferred)
The mobile POS `CheckoutScreen` still submits via `ordersApi.create` (legacy `orders` table), bypassing sessions. The API's `POST /orders` still works for backward compat. Full wrapping into a fleeting session is **not implemented yet** — do not smuggle this into bug-fix PRs. Scope it as its own task when needed.

### Split Payments (deferred)
`'split'` is rejected at the session settle Zod enum API-side. Mobile `SplitPaymentScreen` still uses the legacy orders path. Session-level split would need `order_payments` rows + tip allocation + multi-charge refund logic — net-new scope.

---

## TanStack Query

```ts
defaultOptions: {
  queries: {
    staleTime: 30 * 1000,        // 30s
    gcTime: 30 * 60 * 1000,      // 30min
    refetchOnWindowFocus: true,  // on foreground
    refetchOnMount: false,       // socket handles updates
    refetchOnReconnect: true,
    retry: 1,
  }
}
```

## Socket.IO Events

```ts
SocketEvents = {
  USER_UPDATED, ORGANIZATION_UPDATED, SESSION_KICKED, SUBSCRIPTION_UPDATED,
  CATALOG_UPDATED, CATALOG_CREATED, CATALOG_DELETED,
  PRODUCT_UPDATED, PRODUCT_CREATED, PRODUCT_DELETED,
  CATEGORY_UPDATED, CATEGORY_CREATED, CATEGORY_DELETED, CATEGORIES_REORDERED,
  ORDER_CREATED, ORDER_UPDATED, ORDER_COMPLETED, ORDER_FAILED, ORDER_DELETED, ORDER_REFUNDED,
  TRANSACTION_CREATED, TRANSACTION_UPDATED, PAYMENT_RECEIVED,
  // Sessions + tables + tabs
  SESSION_CREATED, SESSION_UPDATED, SESSION_ITEMS_ADDED, SESSION_SETTLED, SESSION_CANCELLED,
  TABLE_STATUS_CHANGED, FLOOR_PLAN_UPDATED,
};
// Note: PREORDER_* constants removed — sessions replace preorders.
// SESSION_KICKED is distinct from the table_session domain events above
// (session_version kick-out, unrelated to table_sessions).
```

---

## API Endpoints Used

### Auth
`POST /auth/login`, `/auth/signup`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`
`GET /auth/me`
`PATCH /auth/profile`
`POST /auth/avatar`

### Catalogs & Products
`GET /catalogs`, `/catalogs/{id}`, `/catalogs/{id}/products`, `/catalogs/{id}/categories`, `/products`
`POST /catalogs/{id}/duplicate`

### Orders & Payments
`POST /orders`, `/orders/{id}/hold`, `/orders/{id}/payments`, `/orders/{id}/complete`, `/orders/{id}/refund`
`GET /orders/{id}`, `/orders/held`
`PATCH /orders/{id}`
`POST /stripe/terminal/connection-token`, `/stripe/terminal/payment-intent`,
  `/stripe/terminal/payment-intent/{id}/send-receipt`, `/stripe/terminal/payment-intent/{id}/simulate`

### Sessions / Floor Plans / Tabs
`GET /sessions` · `/sessions/{id}` · `/sessions/stats` · `/sessions/tabs`
`POST /sessions` · `/sessions/{id}/items` · `/sessions/{id}/settle` · `/sessions/{id}/cancel`
`POST /sessions/{id}/open-tab` · `/sessions/{id}/close-tab`
`PATCH /sessions/{id}` · `/sessions/{id}/items/{itemId}`
`DELETE /sessions/{id}/items/{itemId}`
`GET /floor-plans` · `/floor-plans/{id}`

### Events (EventsScanner)
`GET /events/{id}` · `POST /tickets/{id}/scan`

### Transactions / Connect / Billing / Org
`GET /stripe/connect/transactions`, `/stripe/connect/status`, `/billing`, `/organizations`, `/locations`

---

## Design System (App-specific)

Root CLAUDE.md has the full palette table. App-specific token file: `/src/lib/colors.ts`.

**Dark (default):** `background: #1C1917`, `card: #292524`, `cardHover: #44403C`, `border: #44403C`, `text: #F5F5F4`, `textSecondary: #A8A29E`, `textMuted: #78716C`, `primary: #F59E0B`, `primaryLight: #FBBF24`, `tabActive: #F59E0B`, `success: #22C55E`, `error: #EF4444`, `warning: #F59E0B`.

**Light:** `background: #FAFAF9`, `card: #FFFFFF`, `text: #1C1917`, `textSecondary: #78716C`.

**Glass effects:** glassmorphic overlays + borders for modals.

**Never use pure `#000000`** (exceptions: phone bezel mockups, QR codes).

Typography: Plus Jakarta Sans (400/500/600/700/800) via `@expo-google-fonts/plus-jakarta-sans`.

---

## Build Configuration

### EAS (`eas.json`)
- **dev:** TestFlight / internal, dev API endpoints.
- **prod:** auto-increment version, production endpoints.

### App Config (`app.config.ts`)
- Name: "Rowie" (prod) / "Rowie (env)" (dev/local)
- Version: 1.0.1, Scheme: `rowie`, Bundle: `com.rowie.app`
- Portrait only; iOS deploy target 16.4+ (TTP); Android minSdk 26 (Terminal).

### Plugins
`expo-font`, `./plugins/withProximityReaderDiscovery`, `expo-alternate-app-icons`, `expo-build-properties`, `@stripe/stripe-react-native`.

### Commands
```bash
npm run dev            # Expo dev server, port 4336
npm run android
npm run ios
npm run build:dev      # Android dev build
npm run build:dev:ios  # iOS dev build + auto-submit
npm run build:prod     # Android prod
npm run submit:ios     # Submit to App Store
```

---

## Environment Variables

```bash
EXPO_PUBLIC_APP_ENV=local          # local | dev | prod
EXPO_PUBLIC_API_URL=http://localhost:4334
EXPO_PUBLIC_WEBSITE_URL=https://rowie.io
EXPO_PUBLIC_VENDOR_DASHBOARD_URL=https://portal.rowie.io
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
```

## Key Features

Tap to Pay · Cash · Split · Held Orders · Per-Item Notes · Biometric Login · Theme + Alternate iOS App Icons · Real-time Sync · TTP Education · Device Tracking · Network Awareness · Data Prefetching.

## Debugging

```powershell
# Android logs (PowerShell)
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat *:S ReactNative:V ReactNativeJS:V
```
`lib/logger.ts` — environment-aware logging (suppressed in production).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| minSdkVersion error | `expo-build-properties` → `minSdkVersion: 26` |
| Stripe Terminal not working | Must use development build (not Expo Go) |
| NFC not detecting | Check device NFC, try different card angle |
| Token refresh loop | Clear secure storage, re-login |
| Socket not connecting | Verify API URL + auth token |
| Biometric unavailable | Check device capabilities + permissions |
| Theme not persisting | Check AsyncStorage access |
| Held orders missing | Verify `deviceId` sent with requests |
| Tap to Pay blocked / "merchant blocked" | Stripe/Apple limits ~3 Connect accounts per device for TTP. After too many test accounts, device gets blocked. NOT a bug — anti-fraud. Use different device or contact Stripe support. |

## Security

- Tokens in `expo-secure-store` (encrypted native).
- Biometric gated by device capability check.
- HTTPS in production. Sensitive data not logged in prod builds.
- Payment data handled entirely by Stripe SDK (PCI compliant).
- Session version validated on every request.
- Device passcode required for Tap to Pay.
