import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { sessionsApi } from '../lib/api/sessions';
import { productsApi, categoriesApi } from '../lib/api';
// Note: we fetch the session to learn its catalog_id — we can't rely on
// selectedCatalog because the user may have switched catalogs since creating
// the session.
import { formatCents } from '../utils/currency';
import { fonts } from '../lib/fonts';
import logger from '../lib/logger';
import { useTranslations } from '../lib/i18n';

type RouteParams = {
  AddItemsToSession: {
    sessionId: string;
    displayName?: string;
  };
};

interface SelectedItem {
  catalogProductId: string;
  name: string;
  price: number; // smallest unit
  quantity: number;
}

/**
 * A lightweight product picker for adding items to an existing session (e.g. a
 * tab or held order). Bypasses the full cart/checkout flow — staff taps
 * products, confirms, and items are sent directly to /sessions/{id}/items.
 */
export function AddItemsToSessionScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'AddItemsToSession'>>();
  const { currency } = useAuth();
  const queryClient = useQueryClient();
  const { sessionId, displayName } = route.params;
  const t = useTranslations('addItemsToSession');

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, SelectedItem>>({});
  // Server-entered notes for the kitchen. Persisted on session_rounds.notes
  // and shown prominently on the kitchen display (red/amber alert block).
  const [roundNotes, setRoundNotes] = useState('');

  // Fetch the session first to get its catalog_id (the staff-selected catalog
  // may be different from the one the session was created on).
  const { data: sessionData, isLoading: loadingSession } = useQuery({
    queryKey: ['sessions', sessionId],
    queryFn: () => sessionsApi.get(sessionId),
  });
  const sessionCatalogId = sessionData?.session.catalogId ?? null;

  // Fetch products for the SESSION's catalog, not the active one.
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ['products', sessionCatalogId],
    queryFn: () => productsApi.list(sessionCatalogId!),
    enabled: !!sessionCatalogId,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', sessionCatalogId],
    queryFn: () => categoriesApi.list(sessionCatalogId!),
    enabled: !!sessionCatalogId,
  });

  const filteredProducts = useMemo(() => {
    if (!selectedCategory) return products;
    return products.filter((p: any) => p.categoryId === selectedCategory);
  }, [products, selectedCategory]);

  const selectedCount = Object.values(selected).reduce((sum, i) => sum + i.quantity, 0);
  const selectedTotalCents = Object.values(selected).reduce(
    (sum, i) => sum + i.price * i.quantity,
    0,
  );

  const handleProductTap = useCallback((product: any) => {
    setSelected((prev) => {
      const existing = prev[product.id];
      if (existing) {
        return { ...prev, [product.id]: { ...existing, quantity: existing.quantity + 1 } };
      }
      return {
        ...prev,
        [product.id]: {
          catalogProductId: product.id,
          name: product.name,
          price: product.price,
          quantity: 1,
        },
      };
    });
  }, []);

  const handleDecrement = useCallback((catalogProductId: string) => {
    setSelected((prev) => {
      const existing = prev[catalogProductId];
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        const { [catalogProductId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [catalogProductId]: { ...existing, quantity: existing.quantity - 1 } };
    });
  }, []);

  const addItemsMutation = useMutation({
    mutationFn: () => {
      const items = Object.values(selected).map((i) => ({
        catalogProductId: i.catalogProductId,
        quantity: i.quantity,
      }));
      return sessionsApi.addItems(sessionId, items, roundNotes.trim() || undefined);
    },
    onSuccess: () => {
      setRoundNotes('');
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      navigation.goBack();
    },
    onError: (err: any) => {
      logger.error('[AddItems] Failed', err);
      // sessionsApi throws ApiError {error, statusCode, code, details} — not
      // an Error instance — so `err?.message` is always undefined and the
      // user would see only the generic fallback.
      Alert.alert(t('failedAddTitle'), err?.error || err?.message || t('failedAddMessage'));
    },
  });

  if (loadingSession || loadingProducts) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={t('loading')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('cancelAndBack')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={26} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
            {t('headerTitle')}
          </Text>
          {displayName && (
            <Text style={[styles.headerSubtitle, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
              {displayName}
            </Text>
          )}
        </View>
        <View style={{ width: 26 }} />
      </View>

      {/* Category filter */}
      {categories.length > 0 && (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[{ id: null as string | null, name: t('categoryAll') }, ...categories]}
          keyExtractor={(item) => item.id || 'all'}
          contentContainerStyle={styles.categoryList}
          renderItem={({ item }) => {
            const isActive = selectedCategory === item.id;
            return (
              <TouchableOpacity
                onPress={() => setSelectedCategory(item.id)}
                style={[
                  styles.categoryChip,
                  {
                    backgroundColor: isActive ? colors.primary : colors.surface,
                    borderColor: isActive ? colors.primary : colors.border,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('filterByCategory', { name: item.name })}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    { color: isActive ? '#1C1917' : colors.textSecondary },
                  ]}
                  maxFontSizeMultiplier={1.3}
                >
                  {item.name}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Product list */}
      <FlatList
        data={filteredProducts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.productList}
        renderItem={({ item }) => {
          const picked = selected[item.id];
          return (
            <ProductRow
              product={item}
              currency={currency}
              quantity={picked?.quantity || 0}
              onAdd={() => handleProductTap(item)}
              onRemove={() => handleDecrement(item.id)}
            />
          );
        }}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
              {t('noProductsInCategory')}
            </Text>
          </View>
        }
      />

      {/* Confirm footer — wrapped in KeyboardAvoidingView so the textarea
          stays visible when the soft keyboard opens. Only rendered once the
          cart has items so the main list doesn't lose space unnecessarily. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          {selectedCount > 0 && (
            <View style={styles.notesWrap}>
              <Text
                style={[styles.notesLabel, { color: colors.textSecondary }]}
                maxFontSizeMultiplier={1.5}
              >
                {t('notesLabel')}
              </Text>
              <TextInput
                value={roundNotes}
                onChangeText={setRoundNotes}
                placeholder={t('notesPlaceholder')}
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={1000}
                accessibilityLabel={t('notesAccessibilityLabel')}
                style={[
                  styles.notesInput,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.card,
                    color: colors.text,
                  },
                ]}
              />
            </View>
          )}
          <TouchableOpacity
            onPress={() => addItemsMutation.mutate()}
            disabled={selectedCount === 0 || addItemsMutation.isPending}
            style={[
              styles.confirmButton,
              { backgroundColor: colors.primary },
              (selectedCount === 0 || addItemsMutation.isPending) && styles.confirmButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              selectedCount === 1
                ? t('addItemAccessibilitySingular', { count: selectedCount, amount: formatCents(selectedTotalCents, currency) })
                : t('addItemAccessibilityPlural', { count: selectedCount, amount: formatCents(selectedTotalCents, currency) })
            }
          >
            {addItemsMutation.isPending ? (
              <ActivityIndicator color="#1C1917" accessibilityLabel={t('addingItemsLabel')} />
            ) : (
              <>
                <Text style={styles.confirmButtonText} maxFontSizeMultiplier={1.3}>
                  {selectedCount === 1
                    ? t('addItemSingular', { count: selectedCount })
                    : t('addItemPlural', { count: selectedCount })}
                </Text>
                <Text style={styles.confirmButtonAmount} maxFontSizeMultiplier={1.2}>
                  {formatCents(selectedTotalCents, currency)}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface ProductRowProps {
  product: any;
  currency: string;
  quantity: number;
  onAdd: () => void;
  onRemove: () => void;
}

const ProductRow = React.memo(function ProductRow({
  product,
  currency,
  quantity,
  onAdd,
  onRemove,
}: ProductRowProps) {
  const { colors } = useTheme();
  const t = useTranslations('addItemsToSession');
  return (
    <View style={[styles.productRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.productInfo}>
        <Text
          style={[styles.productName, { color: colors.text }]}
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
        >
          {product.name}
        </Text>
        <Text
          style={[styles.productPrice, { color: colors.primary }]}
          maxFontSizeMultiplier={1.3}
        >
          {formatCents(product.price, currency)}
        </Text>
      </View>
      <View style={styles.productActions}>
        {quantity > 0 && (
          <>
            <TouchableOpacity
              onPress={onRemove}
              style={[styles.qtyButton, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel={t('removeOneAccessibility', { name: product.name })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="remove" size={16} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.qtyText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              {quantity}
            </Text>
          </>
        )}
        <TouchableOpacity
          onPress={onAdd}
          style={[styles.qtyButton, { borderColor: colors.primary, backgroundColor: colors.primary + '15' }]}
          accessibilityRole="button"
          accessibilityLabel={t('addAccessibility', { name: product.name })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="add" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 18, fontFamily: fonts.bold },
  headerSubtitle: { fontSize: 12, fontFamily: fonts.regular, marginTop: 2 },
  categoryList: { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  categoryChipText: { fontSize: 13, fontFamily: fonts.semiBold },
  productList: { padding: 16, gap: 8, paddingBottom: 100 },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 64,
    marginBottom: 8,
    gap: 12,
  },
  productInfo: { flex: 1, gap: 4 },
  productName: { fontSize: 15, fontFamily: fonts.semiBold },
  productPrice: { fontSize: 14, fontFamily: fonts.bold },
  productActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyText: { fontSize: 15, fontFamily: fonts.bold, minWidth: 16, textAlign: 'center' },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
  },
  notesWrap: {
    marginBottom: 10,
  },
  notesLabel: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  notesInput: {
    minHeight: 48,
    maxHeight: 100,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fonts.regular,
    textAlignVertical: 'top',
  },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    borderRadius: 16,
    paddingHorizontal: 20,
  },
  confirmButtonDisabled: { opacity: 0.5 },
  confirmButtonText: { fontSize: 16, fontFamily: fonts.bold, color: '#1C1917' },
  confirmButtonAmount: { fontSize: 18, fontFamily: fonts.bold, color: '#1C1917' },
  emptyText: { fontSize: 14, fontFamily: fonts.regular, textAlign: 'center' },
});
