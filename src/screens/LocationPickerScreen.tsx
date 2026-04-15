import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { useTranslations } from '../lib/i18n';

// Shape of a location row as returned by /auth/login and /auth/me. Kept
// permissive because the API returns more fields than we render here.
interface AccessibleLocation {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  timezone?: string | null;
  isDefault?: boolean;
  [key: string]: any;
}

/**
 * Shift-start location picker for multi-location vendors.
 *
 * Rendered when `accessibleLocations.length > 1` and no valid
 * `currentLocationId` is persisted in AsyncStorage. Single-location vendors
 * never see this screen — the navigator in `App.tsx` skips straight to the
 * catalog picker.
 *
 * Also rendered as a modal from SettingsScreen when the user wants to switch
 * locations mid-session. In that case `navigation.canGoBack()` is true and
 * we show a close button.
 */
export function LocationPickerScreen() {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const { accessibleLocations } = useAuth() as {
    accessibleLocations?: AccessibleLocation[];
  };
  const t = useTranslations('locations');
  const tc = useTranslations('common');

  const [selectingId, setSelectingId] = useState<string | null>(null);

  const isModal = navigation.canGoBack();
  const locations: AccessibleLocation[] = accessibleLocations || [];

  const handleSelect = useCallback(
    async (location: AccessibleLocation) => {
      setSelectingId(location.id);
      try {
        await AsyncStorage.setItem('currentLocationId', location.id);
        // The API client reads the header fresh on every request (via
        // getCurrentLocationId), so no context refresh is needed — the next
        // request uses the new location. Navigate onward.
        if (isModal) {
          navigation.goBack();
        } else {
          // First-time shift start: hand off to catalog picker.
          navigation.reset({
            index: 0,
            routes: [{ name: 'CatalogSelect' }],
          });
        }
      } finally {
        setSelectingId(null);
      }
    },
    [navigation, isModal]
  );

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  // Edge case: the navigator should never route here with zero locations,
  // but guard anyway so a stale AuthContext doesn't lock the user out.
  if (locations.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconContainer}>
            <Ionicons name="location-outline" size={44} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={1.2}>
            {t('noAccessibleLocations')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderLocation = ({ item }: { item: AccessibleLocation }) => {
    const isSelecting = selectingId === item.id;
    const subtitle = [item.city, item.state].filter(Boolean).join(', ');

    return (
      <TouchableOpacity
        style={[styles.card, isSelecting && styles.cardSelecting]}
        onPress={() => handleSelect(item)}
        disabled={selectingId !== null}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={item.name}
        accessibilityHint={t('switchLocation')}
      >
        <View style={styles.cardIcon}>
          <Ionicons name="location" size={22} color={colors.primary} />
        </View>
        <View style={styles.cardInfo}>
          <View style={styles.cardNameRow}>
            <Text style={styles.cardName} maxFontSizeMultiplier={1.3}>
              {item.name}
            </Text>
            {item.isDefault && (
              <View style={styles.defaultBadge}>
                <Text style={styles.defaultBadgeText} maxFontSizeMultiplier={1.2}>
                  {t('defaultBadge')}
                </Text>
              </View>
            )}
          </View>
          {subtitle ? (
            <Text style={styles.cardSubtitle} maxFontSizeMultiplier={1.5}>
              {subtitle}
            </Text>
          ) : null}
          {item.timezone ? (
            <Text style={styles.cardMeta} maxFontSizeMultiplier={1.5}>
              {item.timezone}
            </Text>
          ) : null}
        </View>
        {isSelecting ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>
            {t('pickerTitle')}
          </Text>
          <Text style={styles.headerSubtitle} maxFontSizeMultiplier={1.5}>
            {t('pickerSubtitle')}
          </Text>
        </View>
        {isModal && (
          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel={tc('close')}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={locations}
        renderItem={renderLocation}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

function createStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#1C1917' : colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerContent: {
      flex: 1,
    },
    headerTitle: {
      fontFamily: fonts.bold,
      fontSize: 24,
      color: colors.text,
      marginBottom: 4,
    },
    headerSubtitle: {
      fontFamily: fonts.regular,
      fontSize: 14,
      color: colors.textSecondary,
    },
    closeButton: {
      padding: 8,
      marginLeft: 12,
      borderRadius: 20,
    },
    listContent: {
      padding: 16,
      gap: 12,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 14,
      ...shadows.sm,
    },
    cardSelecting: {
      borderColor: colors.primary,
    },
    cardIcon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: isDark ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.08)',
      borderWidth: 1,
      borderColor: 'rgba(245,158,11,0.2)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardInfo: {
      flex: 1,
      minWidth: 0,
    },
    cardNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    cardName: {
      fontFamily: fonts.semiBold,
      fontSize: 16,
      color: colors.text,
      flexShrink: 1,
    },
    defaultBadge: {
      backgroundColor: colors.primary,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
    },
    defaultBadgeText: {
      fontFamily: fonts.semiBold,
      fontSize: 10,
      color: '#fff',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    cardSubtitle: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    cardMeta: {
      fontFamily: fonts.regular,
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 40,
    },
    emptyIconContainer: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: isDark ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.08)',
      borderWidth: 1,
      borderColor: 'rgba(245,158,11,0.2)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    emptyTitle: {
      fontFamily: fonts.semiBold,
      fontSize: 16,
      color: colors.text,
      textAlign: 'center',
    },
  });
}
