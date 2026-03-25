import React, { useState, useMemo, useCallback, useRef, memo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Image,
  Platform,
  Animated,
  Pressable,
  useWindowDimensions,
  TextInput,
  Alert,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';

// Conditionally import DraggableFlatList - uses reanimated which crashes in Expo Go
const isExpoGo = Constants.appOwnership === 'expo';
let DraggableFlatList: any;
let ScaleDecorator: any;
type RenderItemParams<T> = { item: T; drag: () => void; isActive: boolean; getIndex: () => number | undefined };

if (!isExpoGo) {
  try {
    const draggable = require('react-native-draggable-flatlist');
    DraggableFlatList = draggable.default;
    ScaleDecorator = draggable.ScaleDecorator;
  } catch (e) {
    DraggableFlatList = FlatList; // Fallback to regular FlatList
    ScaleDecorator = ({ children }: any) => children;
  }
} else {
  DraggableFlatList = FlatList; // Fallback to regular FlatList in Expo Go
  ScaleDecorator = ({ children }: any) => children;
}
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';

import { useTheme } from '../context/ThemeContext';
import { useCatalog } from '../context/CatalogContext';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useSocketEvent, SocketEvents } from '../context/SocketContext';
import {
  productsApi,
  Product,
  categoriesApi,
  Category,
  CatalogLayoutType,
  catalogsApi,
  catalogProductsApi,
  libraryProductsApi,
  UpdateCatalogData,
  LibraryProduct,
} from '../lib/api';
import { formatCents } from '../utils/currency';
import { openVendorDashboard } from '../lib/auth-handoff';
import { SetupRequired } from '../components/SetupRequired';
import { ProductModal } from '../components/ProductModal';
import { CategoryManagerModal } from '../components/CategoryManagerModal';
import { CatalogSettingsModal } from '../components/CatalogSettingsModal';
import { ItemNotesModal } from '../components/ItemNotesModal';
import { StarBackground } from '../components/StarBackground';
import { QuickChargeBottomSheet } from '../components/QuickChargeBottomSheet';
import { glass } from '../lib/colors';
import { shadows } from '../lib/shadows';
import { useTapToPayGuard } from '../hooks';

const isWeb = Platform.OS === 'web';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Star component for Apple-style sparkle effect
function Star({ style, size = 8, color = 'rgba(255,255,255,0.8)' }: { style?: any; size?: number; color?: string }) {
  return (
    <View style={[{ position: 'absolute' }, style]}>
      <View style={{
        width: size,
        height: size,
        backgroundColor: color,
        borderRadius: size / 2,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: size * 1.5,
      }} />
    </View>
  );
}

// Four-point star for larger sparkles
function FourPointStar({ style, size = 16, color = 'rgba(255,255,255,0.9)' }: { style?: any; size?: number; color?: string }) {
  return (
    <View style={[{ position: 'absolute', width: size, height: size }, style]}>
      <View style={{
        position: 'absolute',
        left: size / 2 - 1,
        top: 0,
        width: 2,
        height: size,
        backgroundColor: color,
        borderRadius: 1,
      }} />
      <View style={{
        position: 'absolute',
        top: size / 2 - 1,
        left: 0,
        width: size,
        height: 2,
        backgroundColor: color,
        borderRadius: 1,
      }} />
      <View style={{
        position: 'absolute',
        left: size / 2 - 2,
        top: size / 2 - 2,
        width: 4,
        height: 4,
        backgroundColor: color,
        borderRadius: 2,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: size / 2,
      }} />
    </View>
  );
}

// Empty state with star background for menu screen
function EmptyMenuState({
  colors,
  isDark,
  searchQuery,
  isEditMode,
  canManage,
  onClearSearch,
  onStartEditing,
  onAddProduct,
  onOpenVendorPortal,
}: {
  colors: any;
  isDark: boolean;
  searchQuery: string;
  isEditMode: boolean;
  canManage: boolean;
  onClearSearch: () => void;
  onStartEditing: () => void;
  onAddProduct: () => void;
  onOpenVendorPortal: () => void;
}) {
  const sparkleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(sparkleAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(sparkleAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View style={[emptyMenuStyles.container, { backgroundColor: isDark ? '#09090b' : colors.background, opacity: fadeAnim }]}>
      {/* Background layer - contains gradient and stars */}
      <View style={[StyleSheet.absoluteFill, { zIndex: 0 }]} pointerEvents="none">
        {/* Subtle gradient overlay */}
        <LinearGradient
          colors={isDark
            ? ['transparent', 'rgba(99, 102, 241, 0.08)', 'rgba(139, 92, 246, 0.05)', 'transparent']
            : ['transparent', 'rgba(99, 102, 241, 0.05)', 'rgba(139, 92, 246, 0.03)', 'transparent']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Star field - Group 1 (fades in/out) */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: sparkleAnim }]}>
          <FourPointStar style={{ top: 40, left: 30 }} size={14} color={isDark ? 'rgba(255,255,255,0.7)' : 'rgba(99,102,241,0.4)'} />
          <Star style={{ top: 80, left: 70 }} size={4} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(99,102,241,0.3)'} />
          <Star style={{ top: 60, right: 50 }} size={6} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(139,92,246,0.35)'} />
          <FourPointStar style={{ top: 100, right: 35 }} size={12} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(99,102,241,0.3)'} />
          <Star style={{ top: 130, left: 45 }} size={3} color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(139,92,246,0.25)'} />
          <Star style={{ top: 70, left: SCREEN_WIDTH * 0.45 }} size={5} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(99,102,241,0.3)'} />
          <Star style={{ top: 150, right: 80 }} size={4} color={isDark ? 'rgba(255,255,255,0.45)' : 'rgba(139,92,246,0.25)'} />
        </Animated.View>

        {/* Star field - Group 2 (opposite fade) */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.subtract(1, sparkleAnim) }]}>
          <Star style={{ top: 50, left: 50 }} size={5} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(99,102,241,0.3)'} />
          <FourPointStar style={{ top: 85, right: 40 }} size={16} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(139,92,246,0.35)'} />
          <Star style={{ top: 120, left: 30 }} size={4} color={isDark ? 'rgba(255,255,255,0.45)' : 'rgba(99,102,241,0.25)'} />
          <Star style={{ top: 75, left: SCREEN_WIDTH * 0.55 }} size={6} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(139,92,246,0.3)'} />
          <FourPointStar style={{ top: 35, right: 90 }} size={10} color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(99,102,241,0.25)'} />
          <Star style={{ top: 140, right: 55 }} size={3} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(139,92,246,0.25)'} />
          <Star style={{ top: 95, left: 90 }} size={5} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(99,102,241,0.3)'} />
        </Animated.View>
      </View>

      {/* Content rendered on top */}
      <View style={[emptyMenuStyles.content, { zIndex: 1 }]}>
        {searchQuery.trim() ? (
          // No search results
          <>
            <View style={[emptyMenuStyles.iconContainer, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(99,102,241,0.1)',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(99,102,241,0.15)'
            }]}>
              <Ionicons name="search-outline" size={44} color={isDark ? 'rgba(255,255,255,0.95)' : colors.primary} />
            </View>
            <Text maxFontSizeMultiplier={1.2} style={[emptyMenuStyles.title, { color: isDark ? '#fff' : colors.text }]}>
              No products found
            </Text>
            <Text maxFontSizeMultiplier={1.5} style={[emptyMenuStyles.subtitle, { color: isDark ? 'rgba(255,255,255,0.55)' : colors.textSecondary }]}>
              Try a different search term
            </Text>
            <TouchableOpacity
              style={[emptyMenuStyles.actionButton, { borderColor: colors.primary }]}
              onPress={onClearSearch}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Text maxFontSizeMultiplier={1.3} style={[emptyMenuStyles.actionButtonText, { color: colors.primary }]}>
                Clear Search
              </Text>
            </TouchableOpacity>
          </>
        ) : isEditMode ? (
          // Empty catalog in edit mode
          <>
            <View style={[emptyMenuStyles.iconContainer, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(99,102,241,0.1)',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(99,102,241,0.15)'
            }]}>
              <Ionicons name="cube-outline" size={44} color={isDark ? 'rgba(255,255,255,0.95)' : colors.primary} />
            </View>
            <Text maxFontSizeMultiplier={1.2} style={[emptyMenuStyles.title, { color: isDark ? '#fff' : colors.text }]}>
              No products yet
            </Text>
            <Text maxFontSizeMultiplier={1.5} style={[emptyMenuStyles.subtitle, { color: isDark ? 'rgba(255,255,255,0.55)' : colors.textSecondary }]}>
              Add your first product to this catalog
            </Text>
            <TouchableOpacity
              style={[emptyMenuStyles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={onAddProduct}
              accessibilityRole="button"
              accessibilityLabel="Add product"
            >
              <Ionicons name="add" size={20} color="#fff" />
              <Text maxFontSizeMultiplier={1.3} style={emptyMenuStyles.primaryButtonText}>Add Product</Text>
            </TouchableOpacity>
          </>
        ) : (
          // No products in catalog (view mode)
          <>
            <View style={[emptyMenuStyles.iconContainer, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(99,102,241,0.1)',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(99,102,241,0.15)'
            }]}>
              <Ionicons name="cube-outline" size={44} color={isDark ? 'rgba(255,255,255,0.95)' : colors.primary} />
            </View>
            <Text maxFontSizeMultiplier={1.2} style={[emptyMenuStyles.title, { color: isDark ? '#fff' : colors.text }]}>
              No products available
            </Text>
            <Text maxFontSizeMultiplier={1.5} style={[emptyMenuStyles.subtitle, { color: isDark ? 'rgba(255,255,255,0.55)' : colors.textSecondary }]}>
              {canManage
                ? 'Tap the edit button to add products to this menu'
                : 'Ask your manager to add products to this menu'}
            </Text>
            {canManage && (
              <TouchableOpacity
                style={[emptyMenuStyles.primaryButton, { backgroundColor: colors.primary }]}
                onPress={onStartEditing}
                accessibilityRole="button"
                accessibilityLabel="Start editing"
                accessibilityHint="Enter edit mode to add products to this menu"
              >
                <Ionicons name="pencil" size={18} color="#fff" />
                <Text maxFontSizeMultiplier={1.3} style={emptyMenuStyles.primaryButtonText}>Start Editing</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </Animated.View>
  );
}

const emptyMenuStyles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    zIndex: 10,
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  actionButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});

// Layout configurations for catalog layout types
const GRID_PADDING = 16; // Padding on left and right of the list
const GRID_GAP = 12; // Gap between cards

const getLayoutConfig = (layoutType: CatalogLayoutType, screenWidth: number) => {
  switch (layoutType) {
    case 'list':
      return { numColumns: 1, cardWidth: screenWidth - (GRID_PADDING * 2) }; // Full width minus padding
    case 'large-grid':
      return { numColumns: 1, cardWidth: screenWidth - (GRID_PADDING * 2) }; // Single column large tiles
    case 'compact':
      return { numColumns: 1, cardWidth: screenWidth - (GRID_PADDING * 2) }; // Minimal text-based list
    case 'grid':
    default:
      // Responsive grid configuration
      if (isWeb && screenWidth >= 1024) {
        return { numColumns: 4, cardWidth: 240 };
      } else if (isWeb && screenWidth >= 768) {
        return { numColumns: 3, cardWidth: 220 };
      } else if (screenWidth >= 600) {
        const numColumns = 3;
        const totalGaps = (numColumns - 1) * GRID_GAP;
        const cardWidth = (screenWidth - (GRID_PADDING * 2) - totalGaps) / numColumns;
        return { numColumns, cardWidth };
      }
      // Mobile: 2 columns
      // Available width = screenWidth - (padding left + padding right) - gap between cards
      const numColumns = 2;
      const totalGaps = (numColumns - 1) * GRID_GAP;
      const cardWidth = (screenWidth - (GRID_PADDING * 2) - totalGaps) / numColumns;
      return { numColumns, cardWidth };
  }
};

// Floating Category Pill Component
interface CategoryPillProps {
  label: string;
  count?: number;
  isActive: boolean;
  onPress: () => void;
  colors: any;
  glassColors: typeof glass.dark;
}

const CategoryPill = memo(function CategoryPill({ label, count, isActive, onPress, colors, glassColors }: CategoryPillProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${label} category${count !== undefined && count > 0 ? `, ${count} products` : ''}`}
      accessibilityState={{ selected: isActive }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: 12,
        backgroundColor: isActive ? colors.primary : glassColors.backgroundElevated,
        borderWidth: 1,
        borderColor: isActive ? colors.primary : glassColors.border,
      }}
    >
      <Text maxFontSizeMultiplier={1.3} style={{
        fontSize: 14,
        fontWeight: isActive ? '600' : '500',
        color: isActive ? '#fff' : colors.textSecondary,
      }}>
        {label}
      </Text>
      {count !== undefined && count > 0 && (
        <View style={{
          paddingHorizontal: 7,
          paddingVertical: 2,
          borderRadius: 10,
          backgroundColor: isActive ? 'rgba(255,255,255,0.25)' : colors.primary + '20',
          minWidth: 22,
          alignItems: 'center',
        }}>
          <Text maxFontSizeMultiplier={1.3} style={{
            fontSize: 12,
            fontWeight: '600',
            color: isActive ? '#fff' : colors.primary,
          }}>
            {count}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

// Animated pressable wrapper for product cards
const AnimatedPressable = memo(function AnimatedPressable({
  children,
  onPress,
  onLongPress,
  style,
  accessibilityLabel,
  accessibilityHint,
}: {
  children: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  style?: any;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
      tension: 150,
      friction: 10,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 150,
      friction: 8,
    }).start();
  }, [scaleAnim]);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <Animated.View style={[style, { transform: [{ scale: scaleAnim }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
});

// Check if user can manage catalog (owner or admin)
const canManageCatalog = (role: string | undefined): boolean => {
  return role === 'owner' || role === 'admin';
};

export function MenuScreen() {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const glassColors = isDark ? glass.dark : glass.light;
  const { isLoading: authLoading, user, completeOnboarding, subscription, currency } = useAuth();
  const { selectedCatalog, catalogs, isLoading: catalogsLoading, refreshCatalogs, setSelectedCatalog } = useCatalog();
  const { addItem, getItemQuantity, decrementItem, itemCount, subtotal } = useCart();
  const { guardCheckout } = useTapToPayGuard();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const { width: screenWidth } = useWindowDimensions();

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);

  // Exit edit mode and selection mode when navigating away from this screen
  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      setIsEditMode(false);
      setIsSelectionMode(false);
      setSelectedProducts(new Set());
    });
    return unsubscribe;
  }, [navigation]);

  // Exit selection mode when edit mode is turned off
  useEffect(() => {
    if (!isEditMode) {
      setIsSelectionMode(false);
      setSelectedProducts(new Set());
    }
  }, [isEditMode]);

  // Modal states
  const [productModalVisible, setProductModalVisible] = useState(false);
  const [categoryManagerVisible, setCategoryManagerVisible] = useState(false);
  const [catalogSettingsVisible, setCatalogSettingsVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [notesModalVisible, setNotesModalVisible] = useState(false);
  const [notesProduct, setNotesProduct] = useState<Product | null>(null);
  const [quickChargeVisible, setQuickChargeVisible] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  // Bulk selection state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());

  // Check if user can manage catalog
  const canManage = canManageCatalog(user?.role);

  // Navigate new users to education screen (which now includes Enable step)
  React.useEffect(() => {
    if (user && user.onboardingCompleted === false && !authLoading) {
      // Mark onboarding as complete immediately to prevent re-triggering
      completeOnboarding();
      // Navigate to education screen with the Enable step
      navigation.navigate('TapToPayEducation' as never);
    }
  }, [user, authLoading, completeOnboarding, navigation]);

  const {
    data: products,
    isLoading: productsLoading,
    error: productsError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['products', selectedCatalog?.id],
    queryFn: () => productsApi.list(selectedCatalog!.id),
    enabled: !!selectedCatalog,
    // Uses default staleTime (30s) - refetches on app foreground to catch updates missed while socket was disconnected
  });

  const { data: categories, refetch: refetchCategories } = useQuery({
    queryKey: ['categories', selectedCatalog?.id],
    queryFn: () => categoriesApi.list(selectedCatalog!.id),
    enabled: !!selectedCatalog,
    // Uses default staleTime (30s) - refetches on app foreground to catch updates missed while socket was disconnected
  });

  // Library products for adding to catalog
  const { data: libraryProducts } = useQuery({
    queryKey: ['libraryProducts'],
    queryFn: () => libraryProductsApi.list(),
    enabled: canManage && isEditMode,
  });

  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [refetch]);

  // Listen for real-time updates to products and categories
  // Use refetchQueries instead of invalidateQueries for immediate updates (bypasses stale time)
  const handleProductsUpdate = useCallback(() => {
    if (selectedCatalog) {
      queryClient.refetchQueries({ queryKey: ['products', selectedCatalog.id], type: 'active' });
    }
  }, [queryClient, selectedCatalog]);

  const handleCategoriesUpdate = useCallback(() => {
    if (selectedCatalog) {
      queryClient.refetchQueries({ queryKey: ['categories', selectedCatalog.id], type: 'active' });
    }
  }, [queryClient, selectedCatalog]);

  // Memoized handler for CATALOG_UPDATED - also refreshes products and categories
  // since catalog-product operations (add/update/remove) emit this event.
  // Note: CatalogContext already handles refreshCatalogs() for this event,
  // so we only need to refetch products and categories here.
  const handleCatalogUpdatedEvent = useCallback(() => {
    handleProductsUpdate();
    handleCategoriesUpdate();
  }, [handleProductsUpdate, handleCategoriesUpdate]);

  // Subscribe to socket events for real-time updates
  // CATALOG_UPDATED is also triggered when catalog products are changed (add/update/remove)
  useSocketEvent(SocketEvents.PRODUCT_CREATED, handleProductsUpdate);
  useSocketEvent(SocketEvents.PRODUCT_UPDATED, handleProductsUpdate);
  useSocketEvent(SocketEvents.PRODUCT_DELETED, handleProductsUpdate);
  useSocketEvent(SocketEvents.CATALOG_UPDATED, handleCatalogUpdatedEvent);
  useSocketEvent(SocketEvents.CATEGORY_CREATED, handleCategoriesUpdate);
  useSocketEvent(SocketEvents.CATEGORY_UPDATED, handleCategoriesUpdate);
  useSocketEvent(SocketEvents.CATEGORY_DELETED, handleCategoriesUpdate);
  useSocketEvent(SocketEvents.CATEGORIES_REORDERED, handleCategoriesUpdate);

  // ============================================================================
  // Mutations
  // ============================================================================

  // Create library product mutation
  const createLibraryProductMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      return libraryProductsApi.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryProducts'] });
    },
  });

  // Update library product mutation
  const updateLibraryProductMutation = useMutation({
    mutationFn: async ({ productId, data }: { productId: string; data: { name?: string; description?: string } }) => {
      return libraryProductsApi.update(productId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryProducts'] });
      if (selectedCatalog) {
        queryClient.invalidateQueries({ queryKey: ['products', selectedCatalog.id] });
      }
    },
  });

  // Upload product image mutation
  const uploadImageMutation = useMutation({
    mutationFn: async ({ productId, uri, fileName, mimeType }: { productId: string; uri: string; fileName: string; mimeType: string }) => {
      return libraryProductsApi.uploadImage(productId, uri, fileName, mimeType);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryProducts'] });
      if (selectedCatalog) {
        queryClient.invalidateQueries({ queryKey: ['products', selectedCatalog.id] });
      }
    },
  });

  // Add product to catalog mutation
  const addToCatalogMutation = useMutation({
    mutationFn: async (data: { catalogId: string; productId: string; price: number; categoryId?: string | null; isActive?: boolean }) => {
      return catalogProductsApi.add(data.catalogId, {
        productId: data.productId,
        price: data.price,
        categoryId: data.categoryId,
        isActive: data.isActive,
      });
    },
    onSuccess: () => {
      if (selectedCatalog) {
        queryClient.invalidateQueries({ queryKey: ['products', selectedCatalog.id] });
      }
    },
  });

  // Update catalog product mutation
  const updateCatalogProductMutation = useMutation({
    mutationFn: async ({ catalogId, catalogProductId, data }: { catalogId: string; catalogProductId: string; data: { price?: number; categoryId?: string | null; isActive?: boolean } }) => {
      return catalogProductsApi.update(catalogId, catalogProductId, data);
    },
    onSuccess: () => {
      if (selectedCatalog) {
        queryClient.invalidateQueries({ queryKey: ['products', selectedCatalog.id] });
      }
    },
  });

  // Remove product from catalog mutation
  const removeFromCatalogMutation = useMutation({
    mutationFn: async ({ catalogId, catalogProductId }: { catalogId: string; catalogProductId: string }) => {
      return catalogProductsApi.remove(catalogId, catalogProductId);
    },
    onSuccess: () => {
      if (selectedCatalog) {
        queryClient.invalidateQueries({ queryKey: ['products', selectedCatalog.id] });
      }
    },
  });

  // Create category mutation
  const createCategoryMutation = useMutation({
    mutationFn: async ({ catalogId, name }: { catalogId: string; name: string }) => {
      return categoriesApi.create(catalogId, { name });
    },
    onSuccess: () => {
      if (selectedCatalog) {
        queryClient.invalidateQueries({ queryKey: ['categories', selectedCatalog.id] });
      }
    },
  });

  // Update category mutation
  const updateCategoryMutation = useMutation({
    mutationFn: async ({ catalogId, categoryId, data }: { catalogId: string; categoryId: string; data: { name?: string; isActive?: boolean } }) => {
      return categoriesApi.update(catalogId, categoryId, data);
    },
    onSuccess: () => {
      if (selectedCatalog) {
        queryClient.invalidateQueries({ queryKey: ['categories', selectedCatalog.id] });
      }
    },
  });

  // Delete category mutation
  const deleteCategoryMutation = useMutation({
    mutationFn: async ({ catalogId, categoryId }: { catalogId: string; categoryId: string }) => {
      return categoriesApi.delete(catalogId, categoryId);
    },
    onSuccess: () => {
      if (selectedCatalog) {
        queryClient.invalidateQueries({ queryKey: ['categories', selectedCatalog.id] });
        queryClient.invalidateQueries({ queryKey: ['products', selectedCatalog.id] });
      }
    },
  });

  // Update catalog mutation
  const updateCatalogMutation = useMutation({
    mutationFn: async ({ catalogId, data }: { catalogId: string; data: UpdateCatalogData }) => {
      return catalogsApi.update(catalogId, data);
    },
    onSuccess: () => {
      refreshCatalogs();
    },
  });

  // Duplicate catalog mutation
  const duplicateCatalogMutation = useMutation({
    mutationFn: async (catalogId: string) => {
      return catalogsApi.duplicate(catalogId);
    },
    onSuccess: async (newCatalog) => {
      await refreshCatalogs();
      setSelectedCatalog(newCatalog);
      setIsEditMode(false);
    },
  });

  // Delete catalog mutation
  const deleteCatalogMutation = useMutation({
    mutationFn: async (catalogId: string) => {
      return catalogsApi.delete(catalogId);
    },
    onSuccess: async () => {
      await refreshCatalogs();
      setIsEditMode(false);
    },
  });

  // Reorder products mutation
  const reorderProductsMutation = useMutation({
    mutationFn: async ({ catalogId, productOrders }: { catalogId: string; productOrders: Array<{ catalogProductId: string; sortOrder: number }> }) => {
      return catalogProductsApi.reorder(catalogId, productOrders);
    },
    onSuccess: () => {
      if (selectedCatalog) {
        queryClient.invalidateQueries({ queryKey: ['products', selectedCatalog.id] });
      }
    },
  });

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleSaveProduct = async (data: {
    name: string;
    description: string;
    price: number;
    categoryId: string | null;
    isActive: boolean;
    image?: { uri: string; fileName: string; mimeType: string };
    removeImage?: boolean;
  }) => {
    if (!selectedCatalog) return;

    if (editingProduct) {
      // Update existing product
      // First update the library product (name, description)
      await updateLibraryProductMutation.mutateAsync({
        productId: editingProduct.productId,
        data: {
          name: data.name,
          description: data.description || undefined,
        },
      });

      // Handle image
      if (data.image) {
        await uploadImageMutation.mutateAsync({
          productId: editingProduct.productId,
          uri: data.image.uri,
          fileName: data.image.fileName,
          mimeType: data.image.mimeType,
        });
      }

      // Update catalog product (price, category, visibility)
      await updateCatalogProductMutation.mutateAsync({
        catalogId: selectedCatalog.id,
        catalogProductId: editingProduct.id,
        data: {
          price: data.price,
          categoryId: data.categoryId,
          isActive: data.isActive,
        },
      });
    } else {
      // Create new product
      // First create the library product
      const libraryProduct = await createLibraryProductMutation.mutateAsync({
        name: data.name,
        description: data.description || undefined,
      });

      // Handle image
      if (data.image) {
        await uploadImageMutation.mutateAsync({
          productId: libraryProduct.id,
          uri: data.image.uri,
          fileName: data.image.fileName,
          mimeType: data.image.mimeType,
        });
      }

      // Add to catalog
      await addToCatalogMutation.mutateAsync({
        catalogId: selectedCatalog.id,
        productId: libraryProduct.id,
        price: data.price,
        categoryId: data.categoryId,
        isActive: data.isActive,
      });
    }

    // Refresh products
    refetch();
  };

  const handleDeleteProduct = (product: Product) => {
    Alert.alert(
      'Remove Product',
      `Remove "${product.name}" from this menu? The product will remain in your library.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!selectedCatalog) return;
            try {
              await removeFromCatalogMutation.mutateAsync({
                catalogId: selectedCatalog.id,
                catalogProductId: product.id,
              });
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to remove product');
            }
          },
        },
      ]
    );
  };

  const handleCreateCategory = async (name: string) => {
    if (!selectedCatalog) return;
    await createCategoryMutation.mutateAsync({
      catalogId: selectedCatalog.id,
      name,
    });
  };

  const handleUpdateCategory = async (categoryId: string, data: { name?: string; isActive?: boolean }) => {
    if (!selectedCatalog) return;
    await updateCategoryMutation.mutateAsync({
      catalogId: selectedCatalog.id,
      categoryId,
      data,
    });
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!selectedCatalog) return;
    await deleteCategoryMutation.mutateAsync({
      catalogId: selectedCatalog.id,
      categoryId,
    });
  };

  const handleSaveCatalog = async (data: UpdateCatalogData) => {
    if (!selectedCatalog) {
      throw new Error('No menu selected');
    }
    await updateCatalogMutation.mutateAsync({
      catalogId: selectedCatalog.id,
      data,
    });
  };

  const handleDuplicateCatalog = async (catalogId: string) => {
    await duplicateCatalogMutation.mutateAsync(catalogId);
  };

  const handleDeleteCatalog = async (catalogId: string) => {
    await deleteCatalogMutation.mutateAsync(catalogId);
  };

  const handleOpenProductModal = (product?: Product) => {
    setEditingProduct(product || null);
    setProductModalVisible(true);
  };

  const handleCloseProductModal = () => {
    setEditingProduct(null);
    setProductModalVisible(false);
  };

  // Bulk selection handlers
  const toggleProductSelection = (productId: string) => {
    setSelectedProducts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };

  const selectAllProducts = () => {
    if (!products) return;
    const allIds = products.map(p => p.id);
    setSelectedProducts(new Set(allIds));
  };

  const clearSelection = () => {
    setSelectedProducts(new Set());
  };

  const handleBulkDelete = async () => {
    if (!selectedCatalog || selectedProducts.size === 0) return;

    Alert.alert(
      'Delete Products',
      `Are you sure you want to remove ${selectedProducts.size} product(s) from this menu?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const promises = Array.from(selectedProducts).map(productId => {
                const product = products?.find(p => p.id === productId);
                if (product) {
                  return removeFromCatalogMutation.mutateAsync({
                    catalogId: selectedCatalog.id,
                    catalogProductId: product.id,
                  });
                }
              });
              await Promise.all(promises);
              setSelectedProducts(new Set());
              setIsSelectionMode(false);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete products');
            }
          },
        },
      ]
    );
  };

  const handleBulkToggleVisibility = async (makeActive: boolean) => {
    if (!selectedCatalog || selectedProducts.size === 0) return;

    try {
      const promises = Array.from(selectedProducts).map(productId => {
        const product = products?.find(p => p.id === productId);
        if (product) {
          return updateCatalogProductMutation.mutateAsync({
            catalogId: selectedCatalog.id,
            catalogProductId: product.id,
            data: { isActive: makeActive },
          });
        }
      });
      await Promise.all(promises);
      setSelectedProducts(new Set());
      setIsSelectionMode(false);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update products');
    }
  };

  // Handle drag end for product reordering
  const handleDragEnd = useCallback(async ({ data }: { data: Product[] }) => {
    if (!selectedCatalog) return;

    // Create the new order array
    const productOrders = data.map((product, index) => ({
      catalogProductId: product.id,
      sortOrder: index,
    }));

    // Optimistically update the local query cache
    queryClient.setQueryData(['products', selectedCatalog.id], data);

    // Call the API to persist the order
    try {
      await reorderProductsMutation.mutateAsync({
        catalogId: selectedCatalog.id,
        productOrders,
      });
    } catch (error: any) {
      // Revert on error by refetching
      queryClient.invalidateQueries({ queryKey: ['products', selectedCatalog.id] });
      Alert.alert('Error', error.message || 'Failed to reorder products');
    }
  }, [selectedCatalog, queryClient, reorderProductsMutation]);

  // Filter active products by category and search query
  const filteredProducts = useMemo(() => {
    if (!products) return [];
    // In edit mode, show all products; otherwise only show active ones
    let filtered = isEditMode ? products : products.filter((p) => p.isActive);

    // Filter by category
    if (selectedCategory) {
      filtered = filtered.filter((p) => p.categoryId === selectedCategory);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((p) =>
        p.name.toLowerCase().includes(query) ||
        (p.description && p.description.toLowerCase().includes(query))
      );
    }

    return filtered;
  }, [products, selectedCategory, searchQuery, isEditMode]);

  // Get categories that have products, sorted by sortOrder
  const activeCategories = useMemo(() => {
    if (!categories || !products) return [];
    // In edit mode, show all categories; otherwise only show active ones with active products
    if (isEditMode) {
      return categories.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    const productCategoryIds = new Set(products.filter(p => p.isActive).map((p) => p.categoryId).filter(Boolean));
    return categories
      .filter((c) => c.isActive && productCategoryIds.has(c.id))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [categories, products, isEditMode]);

  // Count products per category (only active products unless in edit mode)
  const productCountByCategory = useMemo(() => {
    if (!products) return new Map<string | null, number>();
    const counts = new Map<string | null, number>();
    const relevantProducts = isEditMode ? products : products.filter(p => p.isActive);

    // Count all products
    counts.set(null, relevantProducts.length);

    // Count per category
    relevantProducts.forEach((p) => {
      const categoryId = p.categoryId || 'uncategorized';
      counts.set(categoryId, (counts.get(categoryId) || 0) + 1);
    });

    return counts;
  }, [products, isEditMode]);

  // Get the layout type from the catalog (layout is per-catalog, not per-category)
  const currentLayoutType: CatalogLayoutType = useMemo(() => {
    return selectedCatalog?.layoutType || 'grid';
  }, [selectedCatalog]);

  // Get layout configuration for current layout type (responsive to screen width changes)
  const { numColumns, cardWidth } = useMemo(
    () => getLayoutConfig(currentLayoutType, screenWidth),
    [currentLayoutType, screenWidth]
  );

  const handleAddToCart = (product: Product) => {
    if (isEditMode) {
      handleOpenProductModal(product);
    } else {
      addItem(product);
    }
  };

  // Long-press opens notes modal
  const handleProductLongPress = (product: Product) => {
    if (!isEditMode) {
      setNotesProduct(product);
      setNotesModalVisible(true);
    }
  };

  const handleAddWithNotes = (notes: string) => {
    if (notesProduct) {
      addItem(notesProduct, 1, notes || undefined);
    }
    setNotesModalVisible(false);
    setNotesProduct(null);
  };

  const handleCancelNotes = () => {
    setNotesModalVisible(false);
    setNotesProduct(null);
  };

  const styles = createStyles(colors, glassColors, cardWidth, currentLayoutType, isEditMode);

  // Check if current layout supports drag-and-drop (single column layouts)
  const supportsDragAndDrop = numColumns === 1 && isEditMode && !isSelectionMode;

  // Render product card based on layout type
  const renderProduct = ({ item, drag, isActive: isDragging }: RenderItemParams<Product>) => {
    const quantity = getItemQuantity(item.id);
    const isInactive = !item.isActive;
    const isSelected = selectedProducts.has(item.id);

    // Handle press based on mode
    const handlePress = () => {
      if (isSelectionMode) {
        toggleProductSelection(item.id);
      } else {
        handleAddToCart(item);
      }
    };

    // Drag handle for single-column layouts in edit mode
    const dragHandle = supportsDragAndDrop ? (
      <Pressable
        style={styles.dragHandle}
        onLongPress={() => {
          drag();
        }}
        delayLongPress={150}
        accessibilityRole="button"
        accessibilityLabel={`Reorder ${item.name}`}
        accessibilityHint="Long press and drag to reorder"
      >
        <Ionicons name="reorder-three" size={22} color={colors.textMuted} />
      </Pressable>
    ) : null;

    // Selection checkbox (only show when in selection mode)
    const selectionCheckbox = isSelectionMode ? (
      <TouchableOpacity
        style={styles.selectionCheckbox}
        onPress={() => toggleProductSelection(item.id)}
        accessibilityRole="checkbox"
        accessibilityLabel={`Select ${item.name}`}
        accessibilityState={{ checked: isSelected }}
      >
        <View style={[styles.checkboxCircle, isSelected && styles.checkboxCircleSelected]}>
          {isSelected && <Ionicons name="checkmark" size={16} color="#fff" />}
        </View>
      </TouchableOpacity>
    ) : null;

    // Edit mode overlay (only show when in edit mode but not selection mode)
    const editOverlay = isEditMode && !isSelectionMode ? (
      <View style={styles.editOverlay}>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => handleOpenProductModal(item)}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${item.name}`}
        >
          <Ionicons name="pencil" size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => handleDeleteProduct(item)}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${item.name}`}
        >
          <Ionicons name="trash-outline" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    ) : null;

    // Inactive badge
    const inactiveBadge = isInactive && isEditMode ? (
      <View style={styles.inactiveBadge}>
        <Text maxFontSizeMultiplier={1.5} style={styles.inactiveBadgeText}>Hidden</Text>
      </View>
    ) : null;

    // List layout - horizontal card with image on left
    if (currentLayoutType === 'list') {
      const listContent = (
        <AnimatedPressable
          style={[
            styles.listCard,
            isInactive && isEditMode && styles.cardInactive,
            isSelected && styles.cardSelected,
            isDragging && styles.cardDragging,
          ]}
          onPress={handlePress}
          onLongPress={supportsDragAndDrop ? undefined : () => undefined /* handleProductLongPress(item) - COMMENTED FOR DEBUGGING */}
          accessibilityLabel={`${item.name}, ${formatCents(item.price, currency)}${quantity > 0 ? `, ${quantity} in cart` : ''}${isInactive && isEditMode ? ', hidden' : ''}`}
          accessibilityHint={isEditMode ? 'Tap to edit product' : 'Tap to add to cart'}
        >
          {dragHandle}
          {selectionCheckbox}
          <View style={styles.listImageContainer}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.listImage} />
            ) : (
              <View style={styles.listImagePlaceholder}>
                <Ionicons name="image-outline" size={24} color={colors.textMuted} />
              </View>
            )}
            {inactiveBadge}
          </View>
          <View style={styles.listInfo}>
            <View style={styles.listTitleRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.listName} numberOfLines={2}>
                {item.name}
              </Text>
              {isSelectionMode ? null : isEditMode ? null : (
                <View style={styles.listQuantityControls}>
                  {quantity > 0 ? (
                    <>
                      <TouchableOpacity
                        style={styles.listQuantityDecrementButton}
                        onPress={() => decrementItem(item.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove one ${item.name} from cart`}
                      >
                        <Ionicons name="remove" size={14} color="#fff" />
                      </TouchableOpacity>
                      <View style={styles.listQuantityBadge} accessibilityLabel={`${quantity} in cart`}>
                        <Text maxFontSizeMultiplier={1.5} style={styles.quantityText}>{quantity}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.listQuantityIncrementButton}
                        onPress={() => handleAddToCart(item)}
                        accessibilityRole="button"
                        accessibilityLabel={`Add one more ${item.name} to cart`}
                      >
                        <Ionicons name="add" size={14} color="#fff" />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={styles.listQuantityIncrementButton}
                      onPress={() => handleAddToCart(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${item.name} to cart`}
                    >
                      <Ionicons name="add" size={14} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
            {item.description ? (
              <Text maxFontSizeMultiplier={1.5} style={styles.listDescription} numberOfLines={2}>
                {item.description}
              </Text>
            ) : null}
            <Text maxFontSizeMultiplier={1.3} style={styles.listPrice}>
              {formatCents(item.price, currency)}
            </Text>
          </View>
          {isSelectionMode ? null : isEditMode ? editOverlay : null}
        </AnimatedPressable>
      );
      return supportsDragAndDrop ? (
        <ScaleDecorator>{listContent}</ScaleDecorator>
      ) : listContent;
    }

    // Large grid layout - single column large tiles
    if (currentLayoutType === 'large-grid') {
      const largeContent = (
        <AnimatedPressable
          style={[
            styles.largeCard,
            isInactive && isEditMode && styles.cardInactive,
            isSelected && styles.cardSelected,
            isDragging && styles.cardDragging,
          ]}
          onPress={handlePress}
          onLongPress={supportsDragAndDrop ? undefined : () => undefined /* handleProductLongPress(item) - COMMENTED FOR DEBUGGING */}
          accessibilityLabel={`${item.name}, ${formatCents(item.price, currency)}${quantity > 0 ? `, ${quantity} in cart` : ''}${isInactive && isEditMode ? ', hidden' : ''}`}
          accessibilityHint={isEditMode ? 'Tap to edit product' : 'Tap to add to cart'}
        >
          {dragHandle}
          {selectionCheckbox}
          <View style={styles.largeImageContainer}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.largeImage} />
            ) : (
              <View style={styles.largeImagePlaceholder}>
                <Ionicons name="image-outline" size={48} color={colors.textMuted} />
              </View>
            )}
            {inactiveBadge}
            {!isSelectionMode && editOverlay}
          </View>
          <View style={styles.largeInfo}>
            <View style={styles.largeTextContainer}>
              <Text maxFontSizeMultiplier={1.3} style={styles.largeName} numberOfLines={2}>
                {item.name}
              </Text>
              {item.description ? (
                <Text maxFontSizeMultiplier={1.5} style={styles.largeDescription} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
            </View>
            <View style={styles.largePriceRow}>
              <Text maxFontSizeMultiplier={1.2} style={styles.largePrice}>
                {formatCents(item.price, currency)}
              </Text>
              {!isEditMode && !isSelectionMode && (
                <View style={styles.largeQuantityControls}>
                  {quantity > 0 ? (
                    <>
                      <TouchableOpacity
                        style={styles.largeQuantityDecrementButton}
                        onPress={() => decrementItem(item.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove one ${item.name} from cart`}
                      >
                        <Ionicons name="remove" size={18} color="#fff" />
                      </TouchableOpacity>
                      <View style={styles.largeQuantityBadge} accessibilityLabel={`${quantity} in cart`}>
                        <Text maxFontSizeMultiplier={1.3} style={styles.largeQuantityText}>{quantity}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.largeQuantityIncrementButton}
                        onPress={() => handleAddToCart(item)}
                        accessibilityRole="button"
                        accessibilityLabel={`Add one more ${item.name} to cart`}
                      >
                        <Ionicons name="add" size={18} color="#fff" />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={styles.largeQuantityIncrementButton}
                      onPress={() => handleAddToCart(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${item.name} to cart`}
                    >
                      <Ionicons name="add" size={18} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          </View>
        </AnimatedPressable>
      );
      return supportsDragAndDrop ? (
        <ScaleDecorator>{largeContent}</ScaleDecorator>
      ) : largeContent;
    }

    // Compact layout - minimal text-based list
    if (currentLayoutType === 'compact') {
      const compactContent = (
        <AnimatedPressable
          style={[
            styles.compactCard,
            isInactive && isEditMode && styles.cardInactive,
            isSelected && styles.cardSelected,
            isDragging && styles.cardDragging,
          ]}
          onPress={handlePress}
          onLongPress={supportsDragAndDrop ? undefined : () => undefined /* handleProductLongPress(item) - COMMENTED FOR DEBUGGING */}
          accessibilityLabel={`${item.name}, ${formatCents(item.price, currency)}${quantity > 0 ? `, ${quantity} in cart` : ''}${isInactive && isEditMode ? ', hidden' : ''}`}
          accessibilityHint={isEditMode ? 'Tap to edit product' : 'Tap to add to cart'}
        >
          {supportsDragAndDrop && (
            <Pressable
              style={styles.dragHandleCompact}
              onLongPress={drag}
              delayLongPress={150}
              onPressIn={(e) => e.stopPropagation()}
              accessibilityRole="button"
              accessibilityLabel={`Reorder ${item.name}`}
              accessibilityHint="Long press and drag to reorder"
            >
              <Ionicons name="reorder-three" size={20} color={colors.textMuted} />
            </Pressable>
          )}
          {isSelectionMode && (
            <View style={[styles.checkboxCircle, styles.checkboxCircleCompact, isSelected && styles.checkboxCircleSelected]}>
              {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
          )}
          <View style={styles.compactInfo}>
            <Text maxFontSizeMultiplier={1.5} style={styles.compactName} numberOfLines={1}>
              {item.name}
            </Text>
            {isInactive && isEditMode && !isSelectionMode && (
              <View style={styles.compactHiddenBadge}>
                <Text maxFontSizeMultiplier={1.5} style={styles.compactHiddenText}>Hidden</Text>
              </View>
            )}
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.compactPrice}>
            {formatCents(item.price, currency)}
          </Text>
          {isSelectionMode ? null : isEditMode ? (
            <View style={styles.compactEditActions}>
              <TouchableOpacity
                style={styles.compactEditButton}
                onPress={() => handleOpenProductModal(item)}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.name}`}
              >
                <Ionicons name="pencil" size={16} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.compactDeleteButton}
                onPress={() => handleDeleteProduct(item)}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${item.name}`}
              >
                <Ionicons name="trash-outline" size={16} color={colors.error} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.compactQuantityControls}>
              {quantity > 0 ? (
                <>
                  <TouchableOpacity
                    style={styles.compactQuantityDecrementButton}
                    onPress={() => decrementItem(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove one ${item.name} from cart`}
                  >
                    <Ionicons name="remove" size={12} color="#fff" />
                  </TouchableOpacity>
                  <View style={styles.compactQuantityBadge} accessibilityLabel={`${quantity} in cart`}>
                    <Text maxFontSizeMultiplier={1.5} style={styles.compactQuantityText}>{quantity}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.compactQuantityIncrementButton}
                    onPress={() => handleAddToCart(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add one more ${item.name} to cart`}
                  >
                    <Ionicons name="add" size={12} color="#fff" />
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={styles.compactQuantityIncrementButton}
                  onPress={() => handleAddToCart(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${item.name} to cart`}
                >
                  <Ionicons name="add" size={14} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          )}
        </AnimatedPressable>
      );
      return supportsDragAndDrop ? (
        <ScaleDecorator>{compactContent}</ScaleDecorator>
      ) : compactContent;
    }

    // Default grid layout
    return (
      <AnimatedPressable
        style={[
          styles.productCard,
          isInactive && isEditMode && styles.cardInactive,
          isSelected && styles.cardSelected,
        ]}
        onPress={handlePress}
        onLongPress={() => undefined /* handleProductLongPress(item) - COMMENTED FOR DEBUGGING */}
        accessibilityLabel={`${item.name}, ${formatCents(item.price, currency)}${quantity > 0 ? `, ${quantity} in cart` : ''}${isInactive && isEditMode ? ', hidden' : ''}`}
        accessibilityHint={isEditMode ? 'Tap to edit product' : 'Tap to add to cart'}
      >
        {selectionCheckbox}
        <View style={styles.productImageContainer}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.productImage} />
          ) : (
            <View style={styles.productImagePlaceholder}>
              <Ionicons name="image-outline" size={32} color={colors.textMuted} />
            </View>
          )}
          {inactiveBadge}
          {!isSelectionMode && editOverlay}
        </View>
        <View style={styles.productInfo}>
          <Text maxFontSizeMultiplier={1.5} style={styles.productName} numberOfLines={2}>
            {item.name}
          </Text>
          <View style={styles.productPriceRow}>
            <Text maxFontSizeMultiplier={1.3} style={styles.productPrice}>
              {formatCents(item.price, currency)}
            </Text>
            {!isEditMode && !isSelectionMode && (
              <View style={styles.quantityControls}>
                {quantity > 0 ? (
                  <>
                    <TouchableOpacity
                      style={styles.quantityDecrementButton}
                      onPress={() => decrementItem(item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove one ${item.name} from cart`}
                    >
                      <Ionicons name="remove" size={14} color="#fff" />
                    </TouchableOpacity>
                    <View style={styles.quantityBadge} accessibilityLabel={`${quantity} in cart`}>
                      <Text maxFontSizeMultiplier={1.5} style={styles.quantityText}>{quantity}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.quantityIncrementButton}
                      onPress={() => handleAddToCart(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Add one more ${item.name} to cart`}
                    >
                      <Ionicons name="add" size={14} color="#fff" />
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    style={styles.quantityIncrementButton}
                    onPress={() => handleAddToCart(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${item.name} to cart`}
                  >
                    <Ionicons name="add" size={14} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>
      </AnimatedPressable>
    );
  };

  // Show skeleton loading while auth or catalogs are being fetched
  if (authLoading || catalogsLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Skeleton Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.skeletonBox, { width: 160, height: 24, borderRadius: 6 }]} />
            <View style={[styles.skeletonBox, { width: 100, height: 14, borderRadius: 4, marginTop: 6 }]} />
          </View>
          <View style={[styles.skeletonBox, { width: 48, height: 48, borderRadius: 16 }]} />
        </View>

        {/* Skeleton Category Pills */}
        <View style={styles.categorySection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryContainer}>
            {[80, 100, 90, 85].map((width, i) => (
              <View key={i} style={[styles.skeletonBox, { width, height: 44, borderRadius: 20, marginRight: 10 }]} />
            ))}
          </ScrollView>
        </View>

        {/* Skeleton Product Grid */}
        <View style={[styles.productList, { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }]}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <View key={i} style={[styles.skeletonBox, { width: (screenWidth - GRID_PADDING * 2 - GRID_GAP) / 2, height: 200, borderRadius: 20 }]} />
          ))}
        </View>
      </View>
    );
  }

  // Show setup guidance if no catalogs exist
  if (catalogs.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <SetupRequired type="no-catalogs" />

        {/* Quick Charge FAB - always available even without menus */}
        <View style={[styles.bottomActions, styles.bottomActionsEmpty]}>
          <TouchableOpacity
            style={[styles.quickChargeFab, { backgroundColor: isDark ? '#fff' : '#09090b' }]}
            onPress={() => setQuickChargeVisible(true)}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Quick charge"
            accessibilityHint="Open quick charge to enter a custom amount"
          >
            <Ionicons name="flash" size={24} color={isDark ? '#09090b' : '#fff'} />
          </TouchableOpacity>
        </View>

        <QuickChargeBottomSheet
          visible={quickChargeVisible}
          onClose={() => setQuickChargeVisible(false)}
        />
      </View>
    );
  }

  if (!selectedCatalog) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.centered}>
          <Text maxFontSizeMultiplier={1.5} style={styles.errorText}>No menu selected</Text>
        </View>
      </View>
    );
  }

  if (productsLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header with catalog name */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text maxFontSizeMultiplier={1.3} style={styles.catalogName}>{selectedCatalog.name}</Text>
            {selectedCatalog.location ? (
              <Text maxFontSizeMultiplier={1.5} style={styles.catalogLocation}>{selectedCatalog.location}</Text>
            ) : null}
          </View>
          <View style={[styles.skeletonBox, { width: 48, height: 48, borderRadius: 16 }]} />
        </View>

        {/* Skeleton Category Pills */}
        <View style={styles.categorySection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryContainer}>
            {[80, 100, 90, 85].map((width, i) => (
              <View key={i} style={[styles.skeletonBox, { width, height: 44, borderRadius: 20, marginRight: 10 }]} />
            ))}
          </ScrollView>
        </View>

        {/* Skeleton Product Grid */}
        <View style={[styles.productList, { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }]}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <View key={i} style={[styles.skeletonBox, { width: (screenWidth - GRID_PADDING * 2 - GRID_GAP) / 2, height: 200, borderRadius: 20 }]} />
          ))}
        </View>
      </View>
    );
  }

  if (productsError && !products) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text maxFontSizeMultiplier={1.3} style={styles.catalogName}>{selectedCatalog.name}</Text>
            {selectedCatalog.location ? (
              <Text maxFontSizeMultiplier={1.5} style={styles.catalogLocation}>{selectedCatalog.location}</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.centered}>
          <View style={{ backgroundColor: colors.error + '15', borderRadius: 40, padding: 16, marginBottom: 16 }}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.error} />
          </View>
          <Text maxFontSizeMultiplier={1.3} style={[styles.emptyTitle, { color: colors.text }]}>Unable to Load Menu</Text>
          <Text maxFontSizeMultiplier={1.5} style={[styles.errorText, { marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }]}>
            Please check your connection and try again
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={{ marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: colors.primary, borderRadius: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading menu"
          >
            <Text maxFontSizeMultiplier={1.3} style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <StarBackground colors={colors} isDark={isDark}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header with glass effect */}
        <View style={styles.header}>
        {isSearching ? (
          // Search mode - show search input
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color={colors.textSecondary} />
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              placeholder="Search products..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search products"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Clear search text"
              >
                <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.cancelSearchButton}
              onPress={() => {
                setIsSearching(false);
                setSearchQuery('');
              }}
              accessibilityRole="button"
              accessibilityLabel="Cancel search"
            >
              <Text maxFontSizeMultiplier={1.3} style={styles.cancelSearchText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          // Normal mode - show catalog name and buttons
          <>
            <View style={styles.headerLeft}>
              <View style={styles.catalogNameRow}>
                <Text maxFontSizeMultiplier={1.3} style={styles.catalogName}>{selectedCatalog.name}</Text>
                {canManage && (
                  <TouchableOpacity
                    style={[styles.editModeButtonSmall, isEditMode && styles.editModeButtonSmallActive]}
                    onPress={() => setIsEditMode(!isEditMode)}
                    activeOpacity={0.8}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityRole="button"
                    accessibilityLabel={isEditMode ? 'Exit edit mode' : 'Enter edit mode'}
                    accessibilityState={{ selected: isEditMode }}
                  >
                    <Ionicons
                      name={isEditMode ? 'checkmark' : 'pencil'}
                      size={16}
                      color={isEditMode ? '#fff' : colors.textSecondary}
                    />
                  </TouchableOpacity>
                )}
              </View>
              {selectedCatalog.location ? (
                <Text maxFontSizeMultiplier={1.5} style={styles.catalogLocation}>{selectedCatalog.location}</Text>
              ) : null}
            </View>
            <View style={styles.headerButtons}>
              {!isEditMode && (
                <TouchableOpacity
                  style={styles.searchButton}
                  onPress={() => {
                    setIsSearching(true);
                    setTimeout(() => searchInputRef.current?.focus(), 100);
                  }}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Search products"
                >
                  <Ionicons name="search" size={20} color={colors.text} />
                </TouchableOpacity>
              )}
              {canManage && isEditMode && (
                <>
                  <TouchableOpacity
                    style={styles.headerIconButton}
                    onPress={() => setCatalogSettingsVisible(true)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Menu settings"
                  >
                    <Ionicons name="settings-outline" size={22} color={colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.headerIconButton}
                    onPress={() => setCategoryManagerVisible(true)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Manage categories"
                  >
                    <Ionicons name="folder-outline" size={22} color={colors.text} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </>
        )}
      </View>

      {/* Category Pills */}
      {activeCategories.length > 0 && (
        <View style={styles.categorySection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoryScroll}
            contentContainerStyle={styles.categoryContainer}
          >
            <CategoryPill
              label="All"
              count={productCountByCategory.get(null)}
              isActive={!selectedCategory}
              onPress={() => setSelectedCategory(null)}
              colors={colors}
              glassColors={glassColors}
            />
            {activeCategories.map((category) => (
              <CategoryPill
                key={category.id}
                label={category.name}
                count={productCountByCategory.get(category.id)}
                isActive={selectedCategory === category.id}
                onPress={() => setSelectedCategory(category.id)}
                colors={colors}
                glassColors={glassColors}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Search Results Count */}
      {searchQuery.trim() ? (
        <View style={styles.searchResultsBar}>
          <Text maxFontSizeMultiplier={1.5} style={styles.searchResultsText}>
            {filteredProducts.length === 0
              ? 'No results'
              : `${filteredProducts.length} result${filteredProducts.length === 1 ? '' : 's'}`}
            {' for "'}
            <Text maxFontSizeMultiplier={1.5} style={styles.searchQueryText}>{searchQuery}</Text>
            {'"'}
          </Text>
        </View>
      ) : null}

      {/* Bulk Actions Toolbar */}
      {isSelectionMode && (
        <View style={styles.bulkActionsBar}>
          <View style={styles.bulkActionsLeft}>
            <Text maxFontSizeMultiplier={1.5} style={styles.selectedCountText}>
              {selectedProducts.size} selected
            </Text>
          </View>
          <View style={styles.bulkActionsRight}>
            {selectedProducts.size > 0 && (
              <>
                <TouchableOpacity
                  style={styles.bulkActionButton}
                  onPress={() => handleBulkToggleVisibility(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${selectedProducts.size} selected products`}
                >
                  <Ionicons name="eye-outline" size={20} color={colors.success} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.bulkActionButton}
                  onPress={() => handleBulkToggleVisibility(false)}
                  accessibilityRole="button"
                  accessibilityLabel={`Hide ${selectedProducts.size} selected products`}
                >
                  <Ionicons name="eye-off-outline" size={20} color={colors.warning} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.bulkActionButton}
                  onPress={handleBulkDelete}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${selectedProducts.size} selected products`}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.error} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      )}

      {/* Products Grid/List */}
      {filteredProducts.length === 0 ? (
        <EmptyMenuState
          colors={colors}
          isDark={isDark}
          searchQuery={searchQuery}
          isEditMode={isEditMode}
          canManage={canManage}
          onClearSearch={() => setSearchQuery('')}
          onStartEditing={() => setIsEditMode(true)}
          onAddProduct={() => handleOpenProductModal()}
          onOpenVendorPortal={() => openVendorDashboard()}
        />
      ) : supportsDragAndDrop ? (
        <DraggableFlatList
          data={filteredProducts}
          renderItem={renderProduct}
          keyExtractor={(item: Product) => item.id}
          onDragEnd={handleDragEnd}
          key={`draggable-${currentLayoutType}`}
          contentContainerStyle={styles.productList}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefreshing}
              onRefresh={handleManualRefresh}
              tintColor={colors.primary}
            />
          }
        />
      ) : (
        <FlatList
          data={filteredProducts}
          renderItem={renderProduct as any}
          keyExtractor={(item) => item.id}
          numColumns={numColumns}
          key={`${currentLayoutType}-${numColumns}`} // Force re-render when layout changes
          contentContainerStyle={styles.productList}
          columnWrapperStyle={numColumns > 1 ? styles.productRow : undefined}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefreshing}
              onRefresh={handleManualRefresh}
              tintColor={colors.primary}
            />
          }
        />
      )}

      {/* FAB for adding products (only in edit mode, not selection mode) */}
      {isEditMode && !isSelectionMode && filteredProducts.length > 0 && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPress={() => handleOpenProductModal()}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Add new product"
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Bottom Action Buttons (only when not in edit mode) */}
      {!isEditMode && (
        <View style={[styles.bottomActions, itemCount === 0 && styles.bottomActionsEmpty]}>
          {/* Quick Charge FAB */}
          <TouchableOpacity
            style={[styles.quickChargeFab, { backgroundColor: isDark ? '#fff' : '#09090b' }]}
            onPress={() => setQuickChargeVisible(true)}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Quick charge"
            accessibilityHint="Open quick charge to enter a custom amount"
          >
            <Ionicons name="flash" size={24} color={isDark ? '#09090b' : '#fff'} />
          </TouchableOpacity>

          {/* Go to Cart Button */}
          {itemCount > 0 && (
            <TouchableOpacity
              style={styles.goToCartButton}
              onPress={() => { if (guardCheckout()) navigation.navigate('Checkout', { total: subtotal }); }}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel={`Go to cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
            >
              <View style={styles.goToCartBadge}>
                <Text maxFontSizeMultiplier={1.3} style={styles.goToCartBadgeText}>{itemCount}</Text>
              </View>
              <Text maxFontSizeMultiplier={1.3} style={styles.goToCartText}>Go to Cart</Text>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Product Modal */}
      <ProductModal
        visible={productModalVisible}
        product={editingProduct}
        categories={categories || []}
        catalogId={selectedCatalog.id}
        onSave={handleSaveProduct}
        onClose={handleCloseProductModal}
        onOpenCategoryManager={() => {
          // Don't close ProductModal - show CategoryManager on top
          setCategoryManagerVisible(true);
        }}
      />

      {/* Category Manager Modal */}
      <CategoryManagerModal
        visible={categoryManagerVisible}
        categories={categories || []}
        catalogId={selectedCatalog.id}
        onCreateCategory={handleCreateCategory}
        onUpdateCategory={handleUpdateCategory}
        onDeleteCategory={handleDeleteCategory}
        onClose={() => setCategoryManagerVisible(false)}
      />

      {/* Catalog Settings Modal */}
      <CatalogSettingsModal
        visible={catalogSettingsVisible}
        catalog={selectedCatalog}
        onSave={handleSaveCatalog}
        onDuplicate={subscription?.tier !== 'starter' && subscription?.tier !== 'free' ? handleDuplicateCatalog : undefined}
        onDelete={user?.role === 'owner' ? handleDeleteCatalog : undefined}
        onClose={() => setCatalogSettingsVisible(false)}
      />

        {/* Item Notes Modal (for long-press to add notes) */}
        <ItemNotesModal
          visible={notesModalVisible}
          product={notesProduct}
          onConfirm={handleAddWithNotes}
          onCancel={handleCancelNotes}
        />

        {/* Quick Charge Bottom Sheet */}
        <QuickChargeBottomSheet
          visible={quickChargeVisible}
          onClose={() => setQuickChargeVisible(false)}
        />
      </View>
    </StarBackground>
  );
}

const createStyles = (colors: any, glassColors: typeof glass.dark, cardWidth: number, layoutType: CatalogLayoutType, isEditMode: boolean) => {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 12,
      backgroundColor: glassColors.backgroundSubtle,
      borderBottomWidth: 1,
      borderBottomColor: glassColors.borderSubtle,
    },
    headerLeft: {
      flex: 1,
    },
    catalogNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    catalogName: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.text,
      letterSpacing: -0.3,
    },
    catalogLocation: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.textSecondary,
      marginTop: 2,
    },
    headerButtons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    searchButton: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.sm,
    },
    headerIconButton: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.sm,
    },
    editModeButton: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.sm,
    },
    editModeButtonActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    editModeButtonSmall: {
      width: 28,
      height: 28,
      borderRadius: 8,
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8,
    },
    editModeButtonSmallActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    searchContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: glassColors.border,
      paddingHorizontal: 12,
      height: 44,
      gap: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
      paddingVertical: 8,
    },
    cancelSearchButton: {
      paddingLeft: 8,
    },
    cancelSearchText: {
      fontSize: 15,
      fontWeight: '500',
      color: colors.primary,
    },
    categorySection: {
      marginBottom: 4,
    },
    categoryScroll: {
      flexGrow: 0,
    },
    categoryContainer: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      gap: 12,
    },
    productList: {
      paddingHorizontal: GRID_PADDING,
      paddingTop: 12,
      paddingBottom: 120, // Extra padding for floating tab bar
    },
    productRow: {
      justifyContent: 'flex-start',
      gap: GRID_GAP,
    },
    // Grid layout styles with glass effect
    productCard: {
      width: cardWidth,
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 20,
      marginBottom: GRID_GAP,
      overflow: 'hidden',
      ...shadows.md,
    },
    cardInactive: {
      opacity: 0.6,
    },
    productImageContainer: {
      width: '100%',
      aspectRatio: 1,
      backgroundColor: glassColors.backgroundElevated,
    },
    productImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    productImagePlaceholder: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glassColors.backgroundSubtle,
    },
    quantityBadge: {
      minWidth: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quantityText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    productPriceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    quantityControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    quantityDecrementButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quantityIncrementButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    productInfo: {
      padding: 14,
    },
    productName: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 6,
      lineHeight: 18,
    },
    productPrice: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.primary,
    },
    addButton: {
      position: 'absolute',
      bottom: 14,
      right: 14,
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.sm,
    },
    // Edit mode overlay
    editOverlay: {
      position: 'absolute',
      top: 8,
      right: 8,
      flexDirection: 'row',
      gap: 6,
    },
    editButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.sm,
    },
    deleteButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.error,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.sm,
    },
    inactiveBadge: {
      position: 'absolute',
      bottom: 8,
      left: 8,
      backgroundColor: 'rgba(0,0,0,0.7)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
    },
    inactiveBadgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: '#fff',
    },
    // List layout styles with glass effect
    listCard: {
      width: cardWidth,
      flexDirection: 'row',
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 20,
      marginBottom: 12,
      overflow: 'hidden',
      alignItems: 'center',
      padding: 14,
      ...shadows.sm,
    },
    listImageContainer: {
      width: 80,
      height: 80,
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 14,
      overflow: 'hidden',
    },
    listImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    listImagePlaceholder: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    listQuantityControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    listQuantityDecrementButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    listQuantityIncrementButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    listQuantityBadge: {
      minWidth: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    listInfo: {
      flex: 1,
      marginLeft: 16,
      marginRight: 12,
    },
    listTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 4,
    },
    listName: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    listDescription: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 6,
    },
    listPrice: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.primary,
    },
    listAddButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Large grid layout styles with glass effect
    largeCard: {
      width: cardWidth,
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 24,
      marginBottom: 16,
      overflow: 'hidden',
      ...shadows.lg,
    },
    largeImageContainer: {
      width: '100%',
      aspectRatio: 16 / 9,
      backgroundColor: glassColors.backgroundElevated,
    },
    largeImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    largeImagePlaceholder: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    largeQuantityControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    largeQuantityDecrementButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    largeQuantityIncrementButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    largeQuantityBadge: {
      minWidth: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    largeQuantityText: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
    },
    largeInfo: {
      padding: 16,
    },
    largeTextContainer: {
      marginBottom: 12,
    },
    largeName: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 6,
    },
    largeDescription: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    largePriceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    largePrice: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.primary,
    },
    largeAddButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Compact layout styles with glass effect
    compactCard: {
      width: cardWidth,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    compactInfo: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    compactName: {
      flex: 1,
      fontSize: 15,
      fontWeight: '500',
      color: colors.text,
    },
    compactQuantityControls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 4,
      marginLeft: 10,
      width: 86,
    },
    compactQuantityDecrementButton: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    compactQuantityIncrementButton: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    compactQuantityBadge: {
      minWidth: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    compactQuantityText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    compactHiddenBadge: {
      backgroundColor: colors.textMuted + '40',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    compactHiddenText: {
      fontSize: 10,
      fontWeight: '500',
      color: colors.textMuted,
    },
    compactPrice: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.primary,
    },
    compactAddButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    compactEditActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    compactEditButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary + '20',
      alignItems: 'center',
      justifyContent: 'center',
    },
    compactDeleteButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.error + '20',
      alignItems: 'center',
      justifyContent: 'center',
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    errorText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
      marginTop: 16,
    },
    emptySubtext: {
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 8,
      textAlign: 'center',
      paddingHorizontal: 32,
    },
    addProductButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 24,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderRadius: 12,
    },
    addProductButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#fff',
    },
    vendorPortalButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 24,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderRadius: 12,
    },
    vendorPortalButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#fff',
    },
    // Search results styles
    searchResultsBar: {
      paddingHorizontal: GRID_PADDING,
      paddingVertical: 8,
    },
    searchResultsText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    searchQueryText: {
      fontWeight: '600',
      color: colors.text,
    },
    clearSearchButton: {
      marginTop: 24,
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: 12,
      borderWidth: 1,
    },
    clearSearchButtonText: {
      fontSize: 16,
      fontWeight: '600',
    },
    // FAB styles
    fab: {
      position: 'absolute',
      bottom: 20,
      right: 20,
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.lg,
    },
    bottomActions: {
      position: 'absolute',
      bottom: 20,
      left: 20,
      right: 20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      justifyContent: 'flex-end',
    },
    bottomActionsEmpty: {
      justifyContent: 'flex-end',
    },
    goToCartButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: '#2563EB',
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 28,
      ...shadows.lg,
    },
    goToCartBadge: {
      backgroundColor: 'rgba(255, 255, 255, 0.25)',
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    goToCartBadgeText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '700',
    },
    goToCartText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
    },
    quickChargeFab: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.lg,
    },
    // Skeleton loading styles
    skeletonBox: {
      backgroundColor: glassColors.backgroundElevated,
      opacity: 0.6,
    },
    // Header icon button active state
    headerIconButtonActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    // Bulk actions bar styles
    bulkActionsBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: GRID_PADDING,
      paddingVertical: 12,
      backgroundColor: colors.primary + '15',
      borderBottomWidth: 1,
      borderBottomColor: colors.primary + '30',
    },
    bulkActionsLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    selectAllButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    selectAllText: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.primary,
    },
    selectedCountText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    bulkActionsRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    bulkActionButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Selection checkbox styles
    selectionCheckbox: {
      position: 'absolute',
      top: 8,
      left: 8,
      zIndex: 10,
    },
    checkboxCircle: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.textMuted,
      backgroundColor: glassColors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxCircleCompact: {
      width: 22,
      height: 22,
      borderRadius: 11,
      marginRight: 12,
    },
    checkboxCircleSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    // Card selected state
    cardSelected: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    // Card dragging state
    cardDragging: {
      opacity: 0.9,
      ...shadows.lg,
    },
    // Drag handle styles
    dragHandle: {
      position: 'absolute',
      top: 8,
      left: 8,
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10,
    },
    dragHandleCompact: {
      marginRight: 12,
      padding: 4,
    },
  });
};
