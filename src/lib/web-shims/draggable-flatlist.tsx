import React from 'react';
import { FlatList } from 'react-native';

// On web: no drag handles, just render as a plain FlatList. MenuScreen
// already handles the fallback shape via try/catch, but exporting the same
// shape is cleaner.

export default FlatList;

export const ScaleDecorator: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <>{children}</>
);

export type RenderItemParams<T> = {
  item: T;
  drag: () => void;
  isActive: boolean;
  getIndex: () => number | undefined;
};
