import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { Catalog } from '../lib/api';
import { openVendorDashboard } from '../lib/auth-handoff';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { useTranslations } from '../lib/i18n';


// Loading state
function LoadingCatalogs({ colors, isDark }: { colors: any; isDark: boolean }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: isDark ? '#1C1917' : colors.background }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

// Empty state
function EmptyCatalogs({ colors, isDark, isManager }: { colors: any; isDark: boolean; isManager: boolean }) {
  const t = useTranslations('catalogs');
  return (
    <View style={[emptyStyles.container, { backgroundColor: isDark ? '#1C1917' : colors.background }]}>
      <View style={emptyStyles.content}>
        <View style={[emptyStyles.iconContainer, {
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(245,158,11,0.1)',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(245,158,11,0.15)'
        }]}>
          <Ionicons name="grid-outline" size={44} color={isDark ? 'rgba(255,255,255,0.95)' : colors.primary} />
        </View>
        <Text style={[emptyStyles.title, { color: isDark ? '#fff' : colors.text }]} maxFontSizeMultiplier={1.2}>
          {t('noMenusAvailable')}
        </Text>
        <Text style={[emptyStyles.subtitle, { color: isDark ? 'rgba(255,255,255,0.55)' : colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
          {isManager
            ? t('emptyManagerSubtitle')
            : t('emptyStaffSubtitle')}
        </Text>
        {isManager && (
          <TouchableOpacity
            style={[emptyStyles.button, { backgroundColor: isDark ? '#fff' : '#1C1917' }]}
            onPress={() => openVendorDashboard('/products')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('openVendorPortalAccessibilityLabel')}
            accessibilityHint={t('openVendorPortalAccessibilityHint')}
          >
            <Text style={[emptyStyles.buttonText, { color: isDark ? '#1C1917' : '#fff' }]} maxFontSizeMultiplier={1.3}>
              {t('openVendorPortalButton')}
            </Text>
            <Ionicons name="arrow-forward" size={18} color={isDark ? '#1C1917' : '#fff'} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
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
    fontFamily: fonts.bold,
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: fonts.regular,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 10,
  },
  buttonText: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
  },
});

export function CatalogSelectScreen() {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { catalogs, selectedCatalog, setSelectedCatalog, refreshCatalogs, isLoading } = useCatalog();
  const isManager = user?.role === 'owner' || user?.role === 'admin';
  const t = useTranslations('catalogs');
  const tc = useTranslations('common');

  const [isRefreshing, setIsRefreshing] = React.useState(false);

  // Check if this screen is presented as a modal (from settings)
  const isModal = navigation.canGoBack();

  const handleSelectCatalog = async (catalog: Catalog) => {
    await setSelectedCatalog(catalog);
    if (isModal) {
      navigation.goBack();
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshCatalogs();
    setIsRefreshing(false);
  };

  const handleClose = () => {
    navigation.goBack();
  };

  const styles = createStyles(colors);

  const renderCatalog = ({ item }: { item: Catalog }) => {
    const isSelected = selectedCatalog?.id === item.id;

    return (
      <TouchableOpacity
        style={[styles.catalogCard, isSelected && styles.catalogCardSelected]}
        onPress={() => handleSelectCatalog(item)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${item.productCount === 1 ? t('catalogAccessibilityLabelSingular', { name: item.name, count: item.productCount }) : t('catalogAccessibilityLabelPlural', { name: item.name, count: item.productCount })}${isSelected ? t('catalogAccessibilityLabelSelectedSuffix') : ''}`}
        accessibilityHint={t('catalogAccessibilityHint')}
      >
        <View style={[styles.catalogIcon, isSelected && styles.catalogIconSelected]}>
          <Ionicons
            name="grid-outline"
            size={24}
            color={isSelected ? '#fff' : colors.primary}
          />
        </View>
        <View style={styles.catalogInfo}>
          <Text style={styles.catalogName} maxFontSizeMultiplier={1.3}>{item.name}</Text>
          {item.location && (
            <View style={styles.catalogMeta}>
              <Ionicons name="location-outline" size={14} color={colors.textMuted} />
              <Text style={styles.catalogMetaText} maxFontSizeMultiplier={1.5}>{item.location}</Text>
            </View>
          )}
          {item.date && (
            <View style={styles.catalogMeta}>
              <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
              <Text style={styles.catalogMetaText} maxFontSizeMultiplier={1.5}>
                {new Date(item.date).toLocaleDateString()}
              </Text>
            </View>
          )}
          <Text style={styles.productCount} maxFontSizeMultiplier={1.5}>
            {t('productCount', { count: item.productCount, unit: item.productCount === 1 ? tc('product') : tc('products') })}
          </Text>
        </View>
        {isSelected ? (
          <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
        ) : (
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        )}
      </TouchableOpacity>
    );
  };

  if (isLoading && catalogs.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingCatalogs colors={colors} isDark={isDark} />
      </SafeAreaView>
    );
  }

  // Filter to only show active catalogs that are not locked (subscription tier restriction)
  const activeCatalogs = catalogs.filter((c) => c.isActive && !c.isLocked);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.title} maxFontSizeMultiplier={1.2}>{isModal ? t('switchMenuTitle') : t('selectMenuTitle')}</Text>
          <Text style={styles.subtitle} maxFontSizeMultiplier={1.5}>
            {isModal
              ? t('switchMenuSubtitle')
              : t('selectMenuSubtitle')}
          </Text>
        </View>
        {isModal && (
          <TouchableOpacity style={styles.closeButton} onPress={handleClose} accessibilityRole="button" accessibilityLabel={t('closeAccessibilityLabel')}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>

      {activeCatalogs.length === 0 ? (
        <EmptyCatalogs colors={colors} isDark={isDark} isManager={isManager} />
      ) : (
        <FlatList
          data={activeCatalogs}
          renderItem={renderCatalog}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const createStyles = (colors: any) => {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 16,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
    },
    headerContent: {
      flex: 1,
    },
    closeButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -8,
      marginRight: -8,
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    title: {
      fontSize: 24,
      fontFamily: fonts.bold,
      color: colors.text,
      marginBottom: 4,
      letterSpacing: -0.3,
    },
    subtitle: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
    },
    list: {
      padding: 16,
      paddingTop: 16,
    },
    catalogCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 12,
      ...shadows.sm,
    },
    catalogCardSelected: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    catalogIcon: {
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: colors.primary + '15',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    catalogIconSelected: {
      backgroundColor: colors.primary,
    },
    catalogInfo: {
      flex: 1,
    },
    catalogName: {
      fontSize: 17,
      fontFamily: fonts.semiBold,
      color: colors.text,
      marginBottom: 4,
    },
    catalogMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 2,
    },
    catalogMetaText: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      marginLeft: 4,
    },
    productCount: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      marginTop: 4,
    },
  });
};
