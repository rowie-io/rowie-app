import React from 'react';
import { TextInput, View, StyleProp, ViewStyle, TextStyle } from 'react-native';

export type ICountry = {
  name: string;
  cca2: string;
  callingCode: string;
  flag?: string;
};

export const isValidPhoneNumber = (_value: string, _country?: ICountry): boolean => {
  // naive check on web — 7+ digits
  return (_value || '').replace(/\D/g, '').length >= 7;
};

type PhoneInputProps = {
  value?: string;
  defaultValue?: string;
  onChangePhoneNumber?: (value: string) => void;
  selectedCountry?: ICountry | null;
  onChangeSelectedCountry?: (country: ICountry) => void;
  placeholder?: string;
  phoneInputStyles?: {
    container?: StyleProp<ViewStyle>;
    flagContainer?: StyleProp<ViewStyle>;
    input?: StyleProp<TextStyle>;
    [key: string]: any;
  };
  placeholderTextColor?: string;
  editable?: boolean;
  [key: string]: any;
};

const PhoneInput: React.FC<PhoneInputProps> = ({
  value,
  defaultValue,
  onChangePhoneNumber,
  placeholder,
  phoneInputStyles,
  placeholderTextColor,
  editable,
}) => (
  <View style={phoneInputStyles?.container}>
    <TextInput
      value={value ?? defaultValue}
      onChangeText={onChangePhoneNumber}
      placeholder={placeholder || 'Phone number'}
      placeholderTextColor={placeholderTextColor}
      keyboardType="phone-pad"
      editable={editable}
      style={[
        { color: '#F5F5F4', fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 },
        phoneInputStyles?.input,
      ]}
    />
  </View>
);

export default PhoneInput;
