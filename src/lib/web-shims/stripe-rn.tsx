import React from 'react';
import { View, Text } from 'react-native';

export const StripeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;

export const CardField = (props: any) => (
  <View
    style={[
      { padding: 12, borderWidth: 1, borderColor: '#44403C', borderRadius: 8, backgroundColor: '#292524' },
      props.style,
    ]}
  >
    <Text style={{ color: '#78716C', fontSize: 14 }} maxFontSizeMultiplier={1.5}>Card input unavailable on web</Text>
  </View>
);

export const useConfirmPayment = () => ({
  confirmPayment: async () => ({
    error: { message: 'Stripe payments are not available on web', code: 'web_unsupported' },
    paymentIntent: null,
  }),
  loading: false,
});

export const initStripe = async (_opts?: any) => {};

export namespace CardFieldInput {
  export type Details = {
    complete: boolean;
    postalCode?: string;
    number?: string;
    expiryMonth?: number;
    expiryYear?: number;
    cvc?: string;
    validNumber?: 'Valid' | 'Invalid' | 'Incomplete';
    validExpiryDate?: 'Valid' | 'Invalid' | 'Incomplete';
    validCVC?: 'Valid' | 'Invalid' | 'Incomplete';
    brand?: string;
  };
}
