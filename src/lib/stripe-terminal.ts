/**
 * Stripe Terminal Service
 *
 * DEPRECATED: This file is kept for backwards compatibility.
 * The Stripe Terminal functionality has been moved to use the official
 * hook-based API via StripeTerminalContext.
 *
 * For new code, use:
 *   import { useTerminal } from '../context/StripeTerminalContext';
 *
 * The old class-based service pattern is incompatible with the
 * @stripe/stripe-terminal-react-native package which requires
 * using the StripeTerminalProvider and useStripeTerminal hook.
 */

// Re-export the hook for convenience
export { useTerminal } from '../context/StripeTerminalContext';

// Legacy stub - throws helpful error if old code tries to use it
class DeprecatedStripeTerminalService {
  private throwDeprecationError(): never {
    throw new Error(
      'stripeTerminalService is deprecated. ' +
      'Use the useTerminal() hook from StripeTerminalContext instead. ' +
      'See src/context/StripeTerminalContext.tsx for the new API.'
    );
  }

  async initialize(): Promise<void> {
    this.throwDeprecationError();
  }

  async discoverReaders(): Promise<any[]> {
    this.throwDeprecationError();
  }

  async connectReader(): Promise<any> {
    this.throwDeprecationError();
  }

  async collectPayment(): Promise<any> {
    this.throwDeprecationError();
  }

  async confirmPayment(): Promise<any> {
    this.throwDeprecationError();
  }

  async processPayment(): Promise<any> {
    this.throwDeprecationError();
  }

  async cancelCollectPayment(): Promise<void> {
    this.throwDeprecationError();
  }

  async disconnectReader(): Promise<void> {
    this.throwDeprecationError();
  }

  async clearCachedCredentials(): Promise<void> {
    this.throwDeprecationError();
  }

  getConnectionStatus(): boolean {
    return false;
  }

  getDiscoveredReaders(): any[] {
    return [];
  }
}

// Export deprecated singleton for backwards compatibility
// Will throw helpful error if any code tries to use the old methods
export const stripeTerminalService = new DeprecatedStripeTerminalService();
