// Stripe Terminal is native-only. The StripeTerminalContext already guards
// with `Platform.OS !== 'web'` and checks `terminal.StripeTerminalProvider`
// existence, so returning empty exports is enough — the context falls back
// to its web/no-terminal branch.

export const StripeTerminalProvider = undefined as any;
export const useStripeTerminal = undefined as any;
export const requestNeededAndroidPermissions = undefined as any;
export default {};
