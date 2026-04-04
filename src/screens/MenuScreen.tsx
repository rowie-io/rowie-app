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
} from 'react-native';
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
import { useTranslations } from '../lib/i18n';
import { openVendorDashboard } from '../lib/auth-handoff';
import { SetupRequired } from '../components/SetupRequired';
import { ProductModal } from '../components/ProductModal';
import { CategoryManagerModal } from '../components/CategoryManagerModal';
import { CatalogSettingsModal } from '../components/CatalogSettingsModal';
import { ItemNotesModal } from '../components/ItemNotesModal';
import { QuickChargeBottomSheet } from '../components/QuickChargeBottomSheet';
import { shadows } from '../lib/shadows';
import { fonts } from '../lib/fonts';
import { brandGradient, brandGradientLight } from '../lib/colors';
import { LinearGradient } from 'expo-linear-gradient';
import { useTapToPayGuard } from '../hooks';

const isWeb = Platform.OS === 'web';

// Empty state for menu screen
function EmptyMenuState({
  colors,
  searchQuery,
  isEditMode,
  canManage,
  onClearSearch,
  onStartEditing,
  onAddProduct,
  onOpenVendorPortal,
}: {
  colors: any;
  searchQuery: string;
  isEditMode: boolean;
  canManage: boolean;
  onClearSearch: () => void;
  onStartEditing: () => void;
  onAddProduct: () => void;
  onOpenVendorPortal: () => void;
}) {
  const t = useTranslations('menu');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View style={[emptyMenuStyles.container, { backgroundColor: colors.background, opacity: fadeAnim }]}>
      <View style={emptyMenuStyles.content}>
        {searchQuery.trim() ? (
          // No search results
          <>
            <Ionicons name="search-outline" size={44} color={colors.textMuted} style={emptyMenuStyles.icon} />
            <Text maxFontSizeMultiplier={1.2} style={[emptyMenuStyles.title, { color: colors.text, fontFamily: fonts.semiBold }]}>
              {t('noProductsFound')}
            </Text>
            <Text maxFontSizeMultiplier={1.5} style={[emptyMenuStyles.subtitle, { color: colors.textSecondary, fontFamily: fonts.regular }]}>
              {t('tryDifferentSearch')}
            </Text>
            <TouchableOpacity
              style={[emptyMenuStyles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={onClearSearch}
              accessibilityRole="button"
              accessibilityLabel={t('clearSearchAccessibilityLabel')}
            >
              <Text maxFontSizeMultiplier={1.3} style={[emptyMenuStyles.primaryButtonText, { fontFamily: fonts.semiBold }]}>
                {t('clearSearchButton')}
              </Text>
            </TouchableOpacity>
          </>
        ) : isEditMode ? (
          // Empty catalog in edit mode
          <>
            <Ionicons name="cube-outline" size={44} color={colors.textMuted} style={emptyMenuStyles.icon} />
            <Text maxFontSizeMultiplier={1.2} style={[emptyMenuStyles.title, { color: colors.text, fontFamily: fonts.semiBold }]}>
              {t('noProductsYet')}
            </Text>
            <Text maxFontSizeMultiplier={1.5} style={[emptyMenuStyles.subtitle, { color: colors.textSecondary, fontFamily: fonts.regular }]}>
              {t('addFirstProduct')}
            </Text>
            <TouchableOpacity
              style={[emptyMenuStyles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={onAddProduct}
              accessibilityRole="button"
              accessibilityLabel={t('addProductAccessibilityLabel')}
            >
              <Ionicons name="add" size={20} color="#fff" />
              <Text maxFontSizeMultiplier={1.3} style={[emptyMenuStyles.primaryButtonText, { fontFamily: fonts.semiBold }]}>{t('addProductButton')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          // No products in catalog (view mode)
          <>
            <Ionicons name="cube-outline" size={44} color={colors.textMuted} style={emptyMenuStyles.icon} />
            <Text maxFontSizeMultiplier={1.2} style={[emptyMenuStyles.title, { color: colors.text, fontFamily: fonts.semiBold }]}>
              {t('noProductsAvailable')}
            </Text>
            <Text maxFontSizeMultiplier={1.5} style={[emptyMenuStyles.subtitle, { color: colors.textSecondary, fontFamily: fonts.regular }]}>
              {canManage
                ? t('emptyManagerHint')
                : t('emptyStaffHint')}
            </Text>
            {canManage && (
              <TouchableOpacity
                style={[emptyMenuStyles.primaryButton, { backgroundColor: colors.primary }]}
                onPress={onStartEditing}
                accessibilityRole="button"
                accessibilityLabel={t('startEditingAccessibilityLabel')}
                accessibilityHint={t('startEditingAccessibilityHint')}
              >
                <Ionicons name="pencil" size={18} color="#fff" />
                <Text maxFontSizeMultiplier={1.3} style={[emptyMenuStyles.primaryButtonText, { fontFamily: fonts.semiBold }]}>{t('startEditingButton')}</Text>
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
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 100,
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
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
    color: '#fff',
  },
});

// Layout configurations for catalog layout types
const GRID_PADDING = 16; // Padding on left and right of the list
const GRID_GAP = 12; // Gap between cards

// Map legacy layout types from API to new types
const normalizeLegacyLayout = (layoutType: string): CatalogLayoutType => {
  switch (layoutType) {
    case 'grid': return 'classic-grid';
    case 'large-grid': return 'cards';
    case 'magazine': return 'split-view';
    default: return layoutType as CatalogLayoutType;
  }
};

const getLayoutConfig = (layoutType: CatalogLayoutType, screenWidth: number) => {
  switch (layoutType) {
    case 'split-view':
      return { numColumns: 1, cardWidth: screenWidth - (GRID_PADDING * 2) }; // Split view: category sidebar + products
    case 'list':
      return { numColumns: 1, cardWidth: screenWidth - (GRID_PADDING * 2) }; // Full width horizontal cards
    case 'cards':
      return { numColumns: 1, cardWidth: screenWidth - (GRID_PADDING * 2) }; // Single column large cards
    case 'mosaic': {
      const numColumns = 2;
      const totalGaps = (numColumns - 1) * GRID_GAP;
      const cardWidth = (screenWidth - (GRID_PADDING * 2) - totalGaps) / numColumns;
      return { numColumns, cardWidth };
    }
    case 'compact':
      return { numColumns: 1, cardWidth: screenWidth - (GRID_PADDING * 2) }; // Minimal text-based list
    case 'classic-grid':
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
  isDark?: boolean;
}

const CategoryPill = memo(function CategoryPill({ label, count, isActive, onPress, colors, isDark = true }: CategoryPillProps) {
  const t = useTranslations('menu');
  const pillContent = (
    <>
      <Text maxFontSizeMultiplier={1.3} style={{
        fontSize: 14,
        fontFamily: isActive ? fonts.semiBold : fonts.medium,
        color: isActive ? '#fff' : colors.textSecondary,
      }}>
        {label}
      </Text>
      {count !== undefined && count > 0 && (
        <View style={{
          paddingHorizontal: 7,
          paddingVertical: 2,
          borderRadius: 10,
          backgroundColor: isActive ? 'rgba(255,255,255,0.25)' : colors.chipBg,
          minWidth: 22,
          alignItems: 'center',
        }}>
          <Text maxFontSizeMultiplier={1.3} style={{
            fontSize: 12,
            fontFamily: fonts.semiBold,
            color: isActive ? '#fff' : colors.textMuted,
          }}>
            {count}
          </Text>
        </View>
      )}
    </>
  );

  const pillStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={count !== undefined && count > 0 ? t('categoryAccessibilityLabelWithCount', { label, count }) : t('categoryAccessibilityLabel', { label })}
      accessibilityState={{ selected: isActive }}
    >
      {isActive ? (
        <LinearGradient
          colors={isDark ? brandGradient : brandGradientLight}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={pillStyle}
        >
          {pillContent}
        </LinearGradient>
      ) : (
        <View style={[pillStyle, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}>
          {pillContent}
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
  const { colors } = useTheme();
  const t = useTranslations('menu');
  const tc = useTranslations('common');
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { isLoading: authLoading, user, completeOnboarding, subscription, currency, isPaymentReady } = useAuth();
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
      t('removeProductTitle'),
      t('removeProductMessage', { name: product.name }),
      [
        { text: tc('cancel'), style: 'cancel' },
        {
          text: t('removeButton'),
          style: 'destructive',
          onPress: async () => {
            if (!selectedCatalog) return;
            try {
              await removeFromCatalogMutation.mutateAsync({
                catalogId: selectedCatalog.id,
                catalogProductId: product.id,
              });
            } catch (error: any) {
              Alert.alert(t('errorTitle'), error.message || t('failedToRemoveProduct'));
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
      throw new Error(t('noMenuSelectedError'));
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
      t('deleteProductsTitle'),
      t('deleteProductsMessage', { count: selectedProducts.size }),
      [
        { text: tc('cancel'), style: 'cancel' },
        {
          text: tc('delete'),
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
              Alert.alert(t('errorTitle'), error.message || t('failedToDeleteProducts'));
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
      Alert.alert(t('errorTitle'), error.message || t('failedToUpdateProducts'));
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
      Alert.alert(t('errorTitle'), error.message || t('failedToReorderProducts'));
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
  // Map legacy values ('grid' -> 'classic-grid', 'large-grid' -> 'cards')
  const currentLayoutType: CatalogLayoutType = useMemo(() => {
    return normalizeLegacyLayout(selectedCatalog?.layoutType || 'classic-grid');
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

  const styles = createStyles(colors, cardWidth, currentLayoutType, isEditMode, screenWidth);

  // Check if current layout supports drag-and-drop (single column layouts, not magazine which uses ScrollView)
  const supportsDragAndDrop = numColumns === 1 && currentLayoutType !== 'split-view' && isEditMode && !isSelectionMode;

  // Helper: build common accessibility label for a product
  const getProductAccessibilityLabel = (item: Product, quantity: number, isInactive: boolean) => {
    if (isInactive && isEditMode) return t('listAccessibilityLabelHidden', { name: item.name, price: formatCents(item.price, currency) });
    if (quantity > 0) return t('listAccessibilityLabelWithQuantity', { name: item.name, price: formatCents(item.price, currency), quantity });
    return t('listAccessibilityLabel', { name: item.name, price: formatCents(item.price, currency) });
  };

  // Helper: render standard quantity controls (increment/decrement/badge)
  const renderQuantityControls = (
    item: Product,
    quantity: number,
    decrementStyle: object,
    incrementStyle: object,
    badgeStyle: object,
    textStyle: object,
    decrementIconSize: number,
    incrementIconSize: number,
  ) => {
    if (isEditMode || isSelectionMode) return null;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {quantity > 0 ? (
          <>
            <TouchableOpacity
              style={decrementStyle}
              onPress={() => decrementItem(item.id)}
              accessibilityRole="button"
              accessibilityLabel={t('removeOneFromCart', { name: item.name })}
            >
              <Ionicons name="remove" size={decrementIconSize} color="#fff" />
            </TouchableOpacity>
            <View style={badgeStyle} accessibilityLabel={t('inCartAccessibilityLabel', { quantity })}>
              <Text maxFontSizeMultiplier={1.5} style={textStyle}>{quantity}</Text>
            </View>
            <TouchableOpacity
              style={incrementStyle}
              onPress={() => handleAddToCart(item)}
              accessibilityRole="button"
              accessibilityLabel={t('addOneMoreToCart', { name: item.name })}
            >
              <Ionicons name="add" size={incrementIconSize} color="#fff" />
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={incrementStyle}
            onPress={() => handleAddToCart(item)}
            accessibilityRole="button"
            accessibilityLabel={t('addToCart', { name: item.name })}
          >
            <Ionicons name="add" size={incrementIconSize} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // Helper: render edit overlay (edit + delete buttons)
  const renderEditOverlay = (item: Product) => {
    if (!isEditMode || isSelectionMode) return null;
    return (
      <View style={styles.editOverlay}>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => handleOpenProductModal(item)}
          accessibilityRole="button"
          accessibilityLabel={t('editAccessibilityLabel', { name: item.name })}
        >
          <Ionicons name="pencil" size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => handleDeleteProduct(item)}
          accessibilityRole="button"
          accessibilityLabel={t('deleteAccessibilityLabel', { name: item.name })}
        >
          <Ionicons name="trash-outline" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  };

  // Helper: render inactive badge
  const renderInactiveBadge = (item: Product) => {
    if (!(!item.isActive && isEditMode)) return null;
    return (
      <View style={styles.inactiveBadge}>
        <Text maxFontSizeMultiplier={1.5} style={styles.inactiveBadgeText}>{t('hiddenBadge')}</Text>
      </View>
    );
  };

  // Helper: render selection checkbox
  const renderSelectionCheckbox = (item: Product) => {
    if (!isSelectionMode) return null;
    const isSelected = selectedProducts.has(item.id);
    return (
      <TouchableOpacity
        style={styles.selectionCheckbox}
        onPress={() => toggleProductSelection(item.id)}
        accessibilityRole="checkbox"
        accessibilityLabel={t('selectAccessibilityLabel', { name: item.name })}
        accessibilityState={{ checked: isSelected }}
      >
        <View style={[styles.checkboxCircle, isSelected && styles.checkboxCircleSelected]}>
          {isSelected && <Ionicons name="checkmark" size={16} color="#fff" />}
        </View>
      </TouchableOpacity>
    );
  };

  // Helper: render drag handle
  const renderDragHandle = (item: Product, drag: () => void) => {
    if (!supportsDragAndDrop) return null;
    return (
      <Pressable
        style={styles.dragHandle}
        onLongPress={() => { drag(); }}
        delayLongPress={150}
        accessibilityRole="button"
        accessibilityLabel={t('reorderAccessibilityLabel', { name: item.name })}
        accessibilityHint={t('reorderAccessibilityHint')}
      >
        <Ionicons name="reorder-three" size={22} color={colors.textMuted} />
      </Pressable>
    );
  };

  // Split View layout: group products by category for sidebar display
  // On phones (<768px), this renders as classic-grid with always-visible category pills
  // On tablets (>=768px), categories render as a left sidebar with products on the right
  const splitViewCategories = useMemo(() => {
    if (currentLayoutType !== 'split-view') return [];
    const cats = categories || [];
    // Add "All" as first option
    return [{ id: null, name: t('allProducts') || 'All' }, ...cats.filter(c => c.isActive)];
  }, [currentLayoutType, categories, t]);

  // Split View: selected category in sidebar (null = all)
  const [splitViewSelectedCat, setSplitViewSelectedCat] = useState<string | null>(null);

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

    // =========================================================================
    // Classic Grid (was "grid") - square image, name, price, round add button
    // =========================================================================
    if (currentLayoutType === 'classic-grid') {
      return (
        <AnimatedPressable
          style={[
            styles.productCard,
            isInactive && isEditMode && styles.cardInactive,
            isSelected && styles.cardSelected,
          ]}
          onPress={handlePress}
          onLongPress={() => undefined}
          accessibilityLabel={getProductAccessibilityLabel(item, quantity, isInactive)}
          accessibilityHint={isEditMode ? t('editModeAccessibilityHint') : t('cartModeAccessibilityHint')}
        >
          {renderSelectionCheckbox(item)}
          <View style={styles.productImageContainer}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.productImage} />
            ) : (
              <View style={styles.productImagePlaceholder}>
                <Ionicons name="image-outline" size={32} color={colors.textMuted} />
              </View>
            )}
            {renderInactiveBadge(item)}
            {renderEditOverlay(item)}
          </View>
          <View style={styles.productInfo}>
            <Text maxFontSizeMultiplier={1.5} style={styles.productName} numberOfLines={2}>
              {item.name}
            </Text>
            <View style={styles.productPriceRow}>
              <Text maxFontSizeMultiplier={1.3} style={styles.productPrice}>
                {formatCents(item.price, currency)}
              </Text>
              {renderQuantityControls(
                item, quantity,
                styles.quantityDecrementButton, styles.quantityIncrementButton,
                styles.quantityBadge, styles.quantityText,
                14, 14,
              )}
            </View>
          </View>
        </AnimatedPressable>
      );
    }

    // Split View uses the classic-grid card rendering via the FlatList above.
    // No special branch needed — it falls through to the default grid card below.

    // =========================================================================
    // List - horizontal card with image on left, name/desc/price on right
    // =========================================================================
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
          onLongPress={supportsDragAndDrop ? undefined : () => undefined}
          accessibilityLabel={getProductAccessibilityLabel(item, quantity, isInactive)}
          accessibilityHint={isEditMode ? t('editModeAccessibilityHint') : t('cartModeAccessibilityHint')}
        >
          {renderDragHandle(item, drag)}
          {renderSelectionCheckbox(item)}
          <View style={styles.listImageContainer}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.listImage} />
            ) : (
              <View style={styles.listImagePlaceholder}>
                <Ionicons name="image-outline" size={24} color={colors.textMuted} />
              </View>
            )}
            {renderInactiveBadge(item)}
          </View>
          <View style={styles.listInfo}>
            <View style={styles.listTitleRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.listName} numberOfLines={2}>
                {item.name}
              </Text>
              {renderQuantityControls(
                item, quantity,
                styles.listQuantityDecrementButton, styles.listQuantityIncrementButton,
                styles.listQuantityBadge, styles.quantityText,
                14, 14,
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
          {isSelectionMode ? null : isEditMode ? renderEditOverlay(item) : null}
        </AnimatedPressable>
      );
      return supportsDragAndDrop ? (
        <ScaleDecorator>{listContent}</ScaleDecorator>
      ) : listContent;
    }

    // =========================================================================
    // Cards (was "large-grid") - single column, large 3:2 image, generous info area
    // =========================================================================
    if (currentLayoutType === 'cards') {
      const cardsContent = (
        <AnimatedPressable
          style={[
            styles.cardsCard,
            isInactive && isEditMode && styles.cardInactive,
            isSelected && styles.cardSelected,
            isDragging && styles.cardDragging,
          ]}
          onPress={handlePress}
          onLongPress={supportsDragAndDrop ? undefined : () => undefined}
          accessibilityLabel={getProductAccessibilityLabel(item, quantity, isInactive)}
          accessibilityHint={isEditMode ? t('editModeAccessibilityHint') : t('cartModeAccessibilityHint')}
        >
          {renderDragHandle(item, drag)}
          {renderSelectionCheckbox(item)}
          <View style={styles.cardsImageContainer}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.cardsImage} />
            ) : (
              <View style={styles.cardsImagePlaceholder}>
                <Ionicons name="image-outline" size={48} color={colors.textMuted} />
              </View>
            )}
            {renderInactiveBadge(item)}
            {renderEditOverlay(item)}
          </View>
          <View style={styles.cardsInfo}>
            <Text maxFontSizeMultiplier={1.3} style={styles.cardsName} numberOfLines={2}>
              {item.name}
            </Text>
            {item.description ? (
              <Text maxFontSizeMultiplier={1.5} style={styles.cardsDescription} numberOfLines={2}>
                {item.description}
              </Text>
            ) : null}
            <Text maxFontSizeMultiplier={1.2} style={styles.cardsPrice}>
              {formatCents(item.price, currency)}
            </Text>
            {!isEditMode && !isSelectionMode && (
              <TouchableOpacity
                style={styles.cardsAddButton}
                onPress={() => handleAddToCart(item)}
                accessibilityRole="button"
                accessibilityLabel={quantity > 0 ? t('addOneMoreToCart', { name: item.name }) : t('addToCart', { name: item.name })}
              >
                {quantity > 0 ? (
                  <View style={styles.cardsAddButtonInner}>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text maxFontSizeMultiplier={1.3} style={styles.cardsAddButtonText}>
                      {t('addOneMoreShort', { quantity })}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.cardsAddButtonInner}>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text maxFontSizeMultiplier={1.3} style={styles.cardsAddButtonText}>
                      {t('addToCartShort')}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          </View>
        </AnimatedPressable>
      );
      return supportsDragAndDrop ? (
        <ScaleDecorator>{cardsContent}</ScaleDecorator>
      ) : cardsContent;
    }

    // =========================================================================
    // Mosaic - 2 columns, alternating heights for visual variety
    // =========================================================================
    if (currentLayoutType === 'mosaic') {
      const itemIndex = filteredProducts.indexOf(item);
      const isOdd = itemIndex % 2 === 0; // First item taller (4:3), second wider (3:2)
      const imageAspect = isOdd ? 4 / 3 : 3 / 2;

      return (
        <AnimatedPressable
          style={[
            styles.mosaicCard,
            isInactive && isEditMode && styles.cardInactive,
            isSelected && styles.cardSelected,
          ]}
          onPress={handlePress}
          onLongPress={() => undefined}
          accessibilityLabel={getProductAccessibilityLabel(item, quantity, isInactive)}
          accessibilityHint={isEditMode ? t('editModeAccessibilityHint') : t('cartModeAccessibilityHint')}
        >
          {renderSelectionCheckbox(item)}
          <View style={[styles.mosaicImageContainer, { aspectRatio: imageAspect }]}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.mosaicImage} />
            ) : (
              <View style={styles.mosaicImagePlaceholder}>
                <Ionicons name="image-outline" size={32} color={colors.textMuted} />
              </View>
            )}
            {/* Gradient overlay at bottom for name + price */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.7)']}
              style={styles.mosaicGradient}
            >
              <Text maxFontSizeMultiplier={1.5} style={styles.mosaicName} numberOfLines={2}>
                {item.name}
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.mosaicPrice}>
                {formatCents(item.price, currency)}
              </Text>
            </LinearGradient>
            {renderInactiveBadge(item)}
            {renderEditOverlay(item)}
            {/* Quantity badge overlay in bottom-right */}
            {!isEditMode && !isSelectionMode && quantity > 0 && (
              <View style={styles.mosaicQuantityBadge}>
                <Text maxFontSizeMultiplier={1.3} style={styles.mosaicQuantityText}>{quantity}</Text>
              </View>
            )}
          </View>
        </AnimatedPressable>
      );
    }

    // =========================================================================
    // Compact - no images, name left, price right, controls far right
    // =========================================================================
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
          onLongPress={supportsDragAndDrop ? undefined : () => undefined}
          accessibilityLabel={getProductAccessibilityLabel(item, quantity, isInactive)}
          accessibilityHint={isEditMode ? t('editModeAccessibilityHint') : t('cartModeAccessibilityHint')}
        >
          {supportsDragAndDrop && (
            <Pressable
              style={styles.dragHandleCompact}
              onLongPress={drag}
              delayLongPress={150}
              onPressIn={(e) => e.stopPropagation()}
              accessibilityRole="button"
              accessibilityLabel={t('reorderAccessibilityLabel', { name: item.name })}
              accessibilityHint={t('reorderAccessibilityHint')}
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
                <Text maxFontSizeMultiplier={1.5} style={styles.compactHiddenText}>{t('hiddenBadge')}</Text>
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
                accessibilityLabel={t('editAccessibilityLabel', { name: item.name })}
              >
                <Ionicons name="pencil" size={16} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.compactDeleteButton}
                onPress={() => handleDeleteProduct(item)}
                accessibilityRole="button"
                accessibilityLabel={t('deleteAccessibilityLabel', { name: item.name })}
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
                    accessibilityLabel={t('removeOneFromCart', { name: item.name })}
                  >
                    <Ionicons name="remove" size={12} color="#fff" />
                  </TouchableOpacity>
                  <View style={styles.compactQuantityBadge} accessibilityLabel={t('inCartAccessibilityLabel', { quantity })}>
                    <Text maxFontSizeMultiplier={1.5} style={styles.compactQuantityText}>{quantity}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.compactQuantityIncrementButton}
                    onPress={() => handleAddToCart(item)}
                    accessibilityRole="button"
                    accessibilityLabel={t('addOneMoreToCart', { name: item.name })}
                  >
                    <Ionicons name="add" size={12} color="#fff" />
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={styles.compactQuantityIncrementButton}
                  onPress={() => handleAddToCart(item)}
                  accessibilityRole="button"
                  accessibilityLabel={t('addToCart', { name: item.name })}
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

    // Fallback: classic-grid (should not reach here due to explicit check above)
    return null;
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
        <SetupRequired type="no-catalogs" onQuickCharge={() => setQuickChargeVisible(true)} />

        {/* Quick Charge FAB - disabled without connected account */}
        <View style={[styles.bottomActions, styles.bottomActionsEmpty, { bottom: insets.bottom }]}>
          <TouchableOpacity
            style={[styles.quickChargeFab, { backgroundColor: colors.text, opacity: isPaymentReady ? 1 : 0.35 }]}
            onPress={() => isPaymentReady && setQuickChargeVisible(true)}
            disabled={!isPaymentReady}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={t('quickChargeAccessibilityLabel')}
            accessibilityHint={t('quickChargeAccessibilityHint')}
            accessibilityState={{ disabled: !isPaymentReady }}
          >
            <Ionicons name="flash" size={22} color={colors.background} />
          </TouchableOpacity>
        </View>

        {isPaymentReady && (
          <QuickChargeBottomSheet
            visible={quickChargeVisible}
            onClose={() => setQuickChargeVisible(false)}
          />
        )}
      </View>
    );
  }

  if (!selectedCatalog) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.centered}>
          <Text maxFontSizeMultiplier={1.5} style={styles.errorText}>{t('noMenuSelected')}</Text>
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
          <Ionicons name="alert-circle-outline" size={44} color={colors.textMuted} style={{ marginBottom: 16 }} />
          <Text maxFontSizeMultiplier={1.3} style={[styles.emptyTitle, { color: colors.text, fontFamily: fonts.semiBold }]}>{t('unableToLoadMenu')}</Text>
          <Text maxFontSizeMultiplier={1.5} style={[styles.errorText, { marginTop: 8, textAlign: 'center', paddingHorizontal: 32, fontFamily: fonts.regular }]}>
            {t('checkConnectionRetry')}
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={{ marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: colors.primary, borderRadius: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t('retryAccessibilityLabel')}
          >
            <Text maxFontSizeMultiplier={1.3} style={{ color: '#fff', fontFamily: fonts.semiBold, fontSize: 15 }}>{t('retryButton')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
        {isSearching ? (
          // Search mode - show search input
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color={colors.textSecondary} />
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              placeholder={t('searchPlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel={t('searchAccessibilityLabel')}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={t('clearSearchTextAccessibilityLabel')}
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
              accessibilityLabel={t('cancelSearchAccessibilityLabel')}
            >
              <Text maxFontSizeMultiplier={1.3} style={styles.cancelSearchText}>{t('cancelSearchButton')}</Text>
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
                    accessibilityLabel={isEditMode ? t('exitEditModeAccessibilityLabel') : t('enterEditModeAccessibilityLabel')}
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
                  accessibilityLabel={t('searchAccessibilityLabel')}
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
                    accessibilityLabel={t('menuSettingsAccessibilityLabel')}
                  >
                    <Ionicons name="settings-outline" size={22} color={colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.headerIconButton}
                    onPress={() => setCategoryManagerVisible(true)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={t('manageCategoriesAccessibilityLabel')}
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
              label={t('allCategoryLabel')}
              count={productCountByCategory.get(null)}
              isActive={!selectedCategory}
              onPress={() => setSelectedCategory(null)}
              colors={colors}
            />
            {activeCategories.map((category) => (
              <CategoryPill
                key={category.id}
                label={category.name}
                count={productCountByCategory.get(category.id)}
                isActive={selectedCategory === category.id}
                onPress={() => setSelectedCategory(category.id)}
                colors={colors}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Search Results Count */}
      {searchQuery.trim() ? (
        <View style={styles.searchResultsBar}>
          <Text maxFontSizeMultiplier={1.5} style={styles.searchResultsText}>
            {t('searchResultsFor', {
              results: filteredProducts.length === 0
                ? t('noResults')
                : filteredProducts.length === 1
                  ? t('searchResultsSingular', { count: filteredProducts.length })
                  : t('searchResultsPlural', { count: filteredProducts.length }),
              query: searchQuery,
            })}
          </Text>
        </View>
      ) : null}

      {/* Bulk Actions Toolbar */}
      {isSelectionMode && (
        <View style={styles.bulkActionsBar}>
          <View style={styles.bulkActionsLeft}>
            <Text maxFontSizeMultiplier={1.5} style={styles.selectedCountText}>
              {t('selectedCount', { count: selectedProducts.size })}
            </Text>
          </View>
          <View style={styles.bulkActionsRight}>
            {selectedProducts.size > 0 && (
              <>
                <TouchableOpacity
                  style={styles.bulkActionButton}
                  onPress={() => handleBulkToggleVisibility(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('showSelectedProducts', { count: selectedProducts.size })}
                >
                  <Ionicons name="eye-outline" size={20} color={colors.success} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.bulkActionButton}
                  onPress={() => handleBulkToggleVisibility(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('hideSelectedProducts', { count: selectedProducts.size })}
                >
                  <Ionicons name="eye-off-outline" size={20} color={colors.warning} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.bulkActionButton}
                  onPress={handleBulkDelete}
                  accessibilityRole="button"
                  accessibilityLabel={t('deleteSelectedProducts', { count: selectedProducts.size })}
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
          searchQuery={searchQuery}
          isEditMode={isEditMode}
          canManage={canManage}
          onClearSearch={() => setSearchQuery('')}
          onStartEditing={() => setIsEditMode(true)}
          onAddProduct={() => handleOpenProductModal()}
          onOpenVendorPortal={() => openVendorDashboard()}
        />
      ) : currentLayoutType === 'split-view' ? (
        /* Split View: category sidebar (tablet) or horizontal pills (phone) + 2-col grid */
        <View style={styles.splitViewContainer}>
          {/* Category sidebar — visible on wider screens, horizontal on phone */}
          <ScrollView
            horizontal={screenWidth < 768}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            style={screenWidth >= 768 ? styles.splitViewSidebar : styles.splitViewHorizontalBar}
            contentContainerStyle={screenWidth >= 768 ? styles.splitViewSidebarContent : styles.splitViewHorizontalBarContent}
          >
            {splitViewCategories.map((cat) => {
              const isActive = splitViewSelectedCat === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id || 'all'}
                  onPress={() => setSplitViewSelectedCat(cat.id)}
                  style={[
                    screenWidth >= 768 ? styles.splitViewSidebarItem : styles.splitViewPill,
                    isActive && (screenWidth >= 768 ? styles.splitViewSidebarItemActive : styles.splitViewPillActive),
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={cat.name}
                  accessibilityState={{ selected: isActive }}
                >
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={[
                      screenWidth >= 768 ? styles.splitViewSidebarText : styles.splitViewPillText,
                      isActive && styles.splitViewTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Products — filtered by selected category */}
          <FlatList
            data={splitViewSelectedCat
              ? filteredProducts.filter(p => p.categoryId === splitViewSelectedCat)
              : filteredProducts
            }
            renderItem={({ item }) => renderProduct({ item, drag: () => {}, isActive: false, getIndex: () => undefined })}
            keyExtractor={(item: Product) => item.id}
            numColumns={2}
            columnWrapperStyle={{ gap: GRID_GAP }}
            contentContainerStyle={[styles.productList, screenWidth >= 768 && { flex: 1 }]}
            refreshControl={
              <RefreshControl
                refreshing={isManualRefreshing}
                onRefresh={handleManualRefresh}
                tintColor={colors.primary}
              />
            }
            style={screenWidth >= 768 ? styles.splitViewProductArea : { flex: 1 }}
          />
        </View>
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
          accessibilityLabel={t('addNewProductAccessibilityLabel')}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Bottom Action Buttons (only when not in edit mode) */}
      {!isEditMode && (
        <View style={[styles.bottomActions, { bottom: insets.bottom }, itemCount === 0 && styles.bottomActionsEmpty]}>
          {/* Quick Charge FAB */}
          <TouchableOpacity
            style={[styles.quickChargeFab, { backgroundColor: colors.text }]}
            onPress={() => setQuickChargeVisible(true)}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={t('quickChargeAccessibilityLabel')}
            accessibilityHint={t('quickChargeAccessibilityHint')}
          >
            <Ionicons name="flash" size={22} color={colors.background} />
          </TouchableOpacity>

          {/* Go to Cart Button */}
          {itemCount > 0 && (
            <TouchableOpacity
              style={styles.goToCartButton}
              onPress={() => { if (guardCheckout()) navigation.navigate('Checkout', { total: subtotal }); }}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel={itemCount === 1 ? t('goToCartAccessibilityLabelSingular', { count: itemCount }) : t('goToCartAccessibilityLabelPlural', { count: itemCount })}
            >
              <View style={styles.goToCartBadge}>
                <Text maxFontSizeMultiplier={1.3} style={styles.goToCartBadgeText}>{itemCount}</Text>
              </View>
              <Text maxFontSizeMultiplier={1.3} style={styles.goToCartText}>{t('goToCartButton')}</Text>
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
        onDuplicate={subscription?.tier !== 'starter' ? handleDuplicateCatalog : undefined}
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
    </View>
  );
}

const createStyles = (colors: any, cardWidth: number, layoutType: CatalogLayoutType, isEditMode: boolean, screenWidth: number) => {
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
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
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
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.sm,
    },
    headerIconButton: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.sm,
    },
    editModeButton: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
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
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
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
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
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
    // Grid layout styles with card styling
    productCard: {
      width: cardWidth,
      backgroundColor: colors.card,
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
      backgroundColor: colors.card,
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
      backgroundColor: colors.surface,
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
    // List layout styles with card styling
    listCard: {
      width: cardWidth,
      flexDirection: 'row',
      backgroundColor: colors.card,
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
      backgroundColor: colors.card,
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
    // Large grid layout styles with card styling
    largeCard: {
      width: cardWidth,
      backgroundColor: colors.card,
      borderRadius: 24,
      marginBottom: 16,
      overflow: 'hidden',
      ...shadows.lg,
    },
    largeImageContainer: {
      width: '100%',
      aspectRatio: 16 / 9,
      backgroundColor: colors.card,
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
    // Cards layout styles (was "large-grid") - single column, 3:2 image, generous info
    cardsCard: {
      width: cardWidth,
      backgroundColor: colors.card,
      borderRadius: 24,
      marginBottom: 16,
      overflow: 'hidden',
      ...shadows.lg,
    },
    cardsImageContainer: {
      width: '100%',
      aspectRatio: 3 / 2,
      backgroundColor: colors.card,
    },
    cardsImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    cardsImagePlaceholder: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    cardsInfo: {
      padding: 16,
    },
    cardsName: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 4,
    },
    cardsDescription: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: 8,
    },
    cardsPrice: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.primary,
      marginBottom: 12,
    },
    cardsAddButton: {
      width: '100%',
      height: 44,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardsAddButtonInner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    cardsAddButtonText: {
      fontSize: 15,
      fontWeight: '600',
      color: '#fff',
    },
    // Magazine layout styles - hero/pair pattern
    // Split View layout styles
    splitViewContainer: {
      flex: 1,
      flexDirection: screenWidth >= 768 ? 'row' : 'column',
    },
    splitViewSidebar: {
      width: 160,
      backgroundColor: colors.card,
      borderRightWidth: 1,
      borderRightColor: colors.border,
    },
    splitViewSidebarContent: {
      paddingVertical: 8,
    },
    splitViewSidebarItem: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderLeftWidth: 3,
      borderLeftColor: 'transparent',
    },
    splitViewSidebarItemActive: {
      backgroundColor: `${colors.primary}15`,
      borderLeftColor: colors.primary,
    },
    splitViewSidebarText: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.textSecondary,
    },
    splitViewHorizontalBar: {
      maxHeight: 44,
      flexGrow: 0,
    },
    splitViewHorizontalBarContent: {
      paddingHorizontal: GRID_PADDING,
      gap: 8,
      alignItems: 'center',
      paddingBottom: 8,
    },
    splitViewPill: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    splitViewPillActive: {
      backgroundColor: `${colors.primary}20`,
      borderColor: colors.primary,
    },
    splitViewPillText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    splitViewTextActive: {
      color: colors.primary,
    },
    splitViewProductArea: {
      flex: 1,
    },
    // Mosaic layout styles - 2 columns, variable height, overlay text
    mosaicCard: {
      width: cardWidth,
      backgroundColor: colors.card,
      borderRadius: 16,
      marginBottom: GRID_GAP,
      overflow: 'hidden',
      ...shadows.md,
    },
    mosaicImageContainer: {
      width: '100%',
      backgroundColor: colors.card,
    },
    mosaicImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    mosaicImagePlaceholder: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    mosaicGradient: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      paddingHorizontal: 10,
      paddingVertical: 8,
      paddingTop: 24,
    },
    mosaicName: {
      fontSize: 13,
      fontWeight: '600',
      color: '#fff',
      marginBottom: 2,
    },
    mosaicPrice: {
      fontSize: 15,
      fontWeight: '700',
      color: '#F59E0B',
    },
    mosaicQuantityBadge: {
      position: 'absolute',
      bottom: 8,
      right: 8,
      minWidth: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    mosaicQuantityText: {
      fontSize: 13,
      fontWeight: '700',
      color: '#fff',
    },
    // Compact layout styles with card styling
    compactCard: {
      width: cardWidth,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
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
      backgroundColor: colors.primary,
      paddingVertical: 13,
      paddingHorizontal: 16,
      borderRadius: 26,
      ...shadows.lg,
    },
    goToCartBadge: {
      backgroundColor: 'rgba(255, 255, 255, 0.25)',
      width: 22,
      height: 22,
      borderRadius: 11,
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
      fontSize: 14,
      fontWeight: '600',
    },
    quickChargeFab: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.lg,
    },
    // Skeleton loading styles
    skeletonBox: {
      backgroundColor: colors.card,
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
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
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
      backgroundColor: colors.background,
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
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
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
