import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode, useMemo } from 'react';
import { Product } from '../lib/api/products';
import { useAuth } from './AuthContext';

export interface CartItem {
  product: Product;
  quantity: number;
  notes?: string; // per-item special instructions
  cartKey: string; // unique key for cart (productId + notes hash)
}

// Generate a unique cart key for an item based on product ID and notes
function generateCartKey(productId: string, notes?: string): string {
  if (!notes || notes.trim() === '') {
    return productId;
  }
  // Simple hash of notes to create unique key
  return `${productId}::${notes.trim().toLowerCase()}`;
}

export type PaymentMethodType = 'tap_to_pay' | 'cash' | 'split';

interface CartContextType {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  orderNotes: string;
  setOrderNotes: (notes: string) => void;
  customerEmail: string;
  setCustomerEmail: (email: string) => void;
  paymentMethod: PaymentMethodType;
  setPaymentMethod: (method: PaymentMethodType) => void;
  selectedTipIndex: number | null;
  setSelectedTipIndex: (index: number | null) => void;
  customTipAmount: string;
  setCustomTipAmount: (amount: string) => void;
  showCustomTipInput: boolean;
  setShowCustomTipInput: (show: boolean) => void;
  addItem: (product: Product, quantity?: number, notes?: string) => void;
  removeItem: (cartKey: string) => void;
  updateQuantity: (cartKey: string, quantity: number) => void;
  updateItemNotes: (cartKey: string, notes: string) => void;
  incrementItem: (cartKey: string) => void;
  decrementItem: (cartKey: string) => void;
  clearCart: () => void;
  getItemQuantity: (productId: string) => number;
  getItemByCartKey: (cartKey: string) => CartItem | undefined;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

interface CartProviderProps {
  children: ReactNode;
}

export function CartProvider({ children }: CartProviderProps) {
  const { user } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [orderNotes, setOrderNotes] = useState<string>('');
  const [customerEmail, setCustomerEmail] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('tap_to_pay');
  const [selectedTipIndex, setSelectedTipIndex] = useState<number | null>(null);
  const [customTipAmount, setCustomTipAmount] = useState<string>('');
  const [showCustomTipInput, setShowCustomTipInput] = useState<boolean>(false);

  // Clear cart when user signs out
  const prevUserId = useRef(user?.id);
  useEffect(() => {
    if (prevUserId.current && !user?.id) {
      // User was logged in, now logged out — clear cart
      setItems([]);
      setOrderNotes('');
      setCustomerEmail('');
      setPaymentMethod('tap_to_pay');
      setSelectedTipIndex(null);
      setCustomTipAmount('');
      setShowCustomTipInput(false);
    }
    prevUserId.current = user?.id;
  }, [user?.id]);

  // Calculate total item count
  const itemCount = useMemo(() => {
    return items.reduce((total, item) => total + item.quantity, 0);
  }, [items]);

  // Calculate subtotal (in cents)
  const subtotal = useMemo(() => {
    return items.reduce((total, item) => total + item.product.price * item.quantity, 0);
  }, [items]);

  // Add item to cart (with optional notes)
  // If same product with same notes exists, increment quantity
  // If same product with different notes, add as new item
  const addItem = useCallback((product: Product, quantity: number = 1, notes?: string) => {
    const cartKey = generateCartKey(product.id, notes);

    setItems((currentItems) => {
      const existingIndex = currentItems.findIndex(
        (item) => item.cartKey === cartKey
      );

      if (existingIndex >= 0) {
        // Item with same product AND notes exists, increment quantity
        const newItems = [...currentItems];
        newItems[existingIndex] = {
          ...newItems[existingIndex],
          quantity: newItems[existingIndex].quantity + quantity,
        };
        return newItems;
      } else {
        // New item (different product or different notes)
        return [...currentItems, {
          product,
          quantity,
          notes: notes?.trim() || undefined,
          cartKey,
        }];
      }
    });
  }, []);

  // Remove item from cart by cartKey
  const removeItem = useCallback((cartKey: string) => {
    setItems((currentItems) =>
      currentItems.filter((item) => item.cartKey !== cartKey)
    );
  }, []);

  // Update item quantity by cartKey
  const updateQuantity = useCallback((cartKey: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(cartKey);
      return;
    }

    setItems((currentItems) =>
      currentItems.map((item) =>
        item.cartKey === cartKey ? { ...item, quantity } : item
      )
    );
  }, [removeItem]);

  // Update item notes - this will change the cartKey
  const updateItemNotes = useCallback((cartKey: string, notes: string) => {
    setItems((currentItems) => {
      const itemIndex = currentItems.findIndex((item) => item.cartKey === cartKey);
      if (itemIndex < 0) return currentItems;

      const item = currentItems[itemIndex];
      const newCartKey = generateCartKey(item.product.id, notes);

      // Check if there's already an item with this new cartKey
      const existingWithNewKey = currentItems.findIndex(
        (i, idx) => idx !== itemIndex && i.cartKey === newCartKey
      );

      if (existingWithNewKey >= 0) {
        // Merge with existing item that has same product + notes
        const newItems = [...currentItems];
        newItems[existingWithNewKey] = {
          ...newItems[existingWithNewKey],
          quantity: newItems[existingWithNewKey].quantity + item.quantity,
        };
        // Remove the original item
        newItems.splice(itemIndex, 1);
        return newItems;
      } else {
        // Just update the notes and cartKey
        const newItems = [...currentItems];
        newItems[itemIndex] = {
          ...item,
          notes: notes.trim() || undefined,
          cartKey: newCartKey,
        };
        return newItems;
      }
    });
  }, []);

  // Increment item quantity by 1 using cartKey
  const incrementItem = useCallback((cartKey: string) => {
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.cartKey === cartKey
          ? { ...item, quantity: item.quantity + 1 }
          : item
      )
    );
  }, []);

  // Decrement item quantity by 1 using cartKey
  const decrementItem = useCallback((cartKey: string) => {
    setItems((currentItems) => {
      const item = currentItems.find((i) => i.cartKey === cartKey);
      if (!item) return currentItems;

      if (item.quantity <= 1) {
        // Remove item if quantity would become 0
        return currentItems.filter((i) => i.cartKey !== cartKey);
      }

      return currentItems.map((i) =>
        i.cartKey === cartKey ? { ...i, quantity: i.quantity - 1 } : i
      );
    });
  }, []);

  // Clear all items, order notes, email, and payment method
  const clearCart = useCallback(() => {
    setItems([]);
    setOrderNotes('');
    setCustomerEmail('');
    setPaymentMethod('tap_to_pay');
    setSelectedTipIndex(null);
    setCustomTipAmount('');
    setShowCustomTipInput(false);
  }, []);

  // Get total quantity of specific product (across all notes variations)
  const getItemQuantity = useCallback(
    (productId: string) => {
      return items
        .filter((i) => i.product.id === productId)
        .reduce((sum, item) => sum + item.quantity, 0);
    },
    [items]
  );

  // Get item by cartKey
  const getItemByCartKey = useCallback(
    (cartKey: string) => {
      return items.find((i) => i.cartKey === cartKey);
    },
    [items]
  );

  const value = useMemo(() => ({
    items,
    itemCount,
    subtotal,
    orderNotes,
    setOrderNotes,
    customerEmail,
    setCustomerEmail,
    paymentMethod,
    setPaymentMethod,
    selectedTipIndex,
    setSelectedTipIndex,
    customTipAmount,
    setCustomTipAmount,
    showCustomTipInput,
    setShowCustomTipInput,
    addItem,
    removeItem,
    updateQuantity,
    updateItemNotes,
    incrementItem,
    decrementItem,
    clearCart,
    getItemQuantity,
    getItemByCartKey,
  }), [items, itemCount, subtotal, orderNotes, setOrderNotes, customerEmail, setCustomerEmail, paymentMethod, setPaymentMethod, selectedTipIndex, setSelectedTipIndex, customTipAmount, setCustomTipAmount, showCustomTipInput, setShowCustomTipInput, addItem, removeItem, updateQuantity, updateItemNotes, incrementItem, decrementItem, clearCart, getItemQuantity, getItemByCartKey]);

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextType {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
