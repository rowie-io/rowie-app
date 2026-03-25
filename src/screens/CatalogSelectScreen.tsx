import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { Catalog } from '../lib/api';
import { openVendorDashboard } from '../lib/auth-handoff';
import { glass } from '../lib/colors';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';

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
      {/* Vertical line */}
      <View style={{
        position: 'absolute',
        left: size / 2 - 1,
        top: 0,
        width: 2,
        height: size,
        backgroundColor: color,
        borderRadius: 1,
      }} />
      {/* Horizontal line */}
      <View style={{
        position: 'absolute',
        top: size / 2 - 1,
        left: 0,
        width: size,
        height: 2,
        backgroundColor: color,
        borderRadius: 1,
      }} />
      {/* Center glow */}
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

// Central glowing star for loading
function GlowingStar({ size = 32, color, glowColor, pulseAnim }: { size?: number; color: string; glowColor: string; pulseAnim: Animated.Value }) {
  return (
    <Animated.View style={{
      width: size * 2,
      height: size * 2,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: pulseAnim,
      transform: [{ scale: pulseAnim }],
    }}>
      <View style={{
        position: 'absolute',
        width: size * 1.5,
        height: size * 1.5,
        borderRadius: size,
        backgroundColor: glowColor,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: size,
      }} />
      <View style={{
        position: 'absolute',
        width: 3,
        height: size,
        backgroundColor: color,
        borderRadius: 1.5,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
      }} />
      <View style={{
        position: 'absolute',
        width: size,
        height: 3,
        backgroundColor: color,
        borderRadius: 1.5,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
      }} />
      <View style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: color,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 10,
      }} />
    </Animated.View>
  );
}

// Loading state with stars
function LoadingCatalogs({ colors, isDark }: { colors: any; isDark: boolean }) {
  const sparkleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.7)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
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

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 8000,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const starColor = isDark ? '#fff' : colors.primary;
  const glowColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(99,102,241,0.2)';

  return (
    <Animated.View style={[starStyles.container, { backgroundColor: isDark ? '#09090b' : colors.background, opacity: fadeAnim }]}>
      <LinearGradient
        colors={isDark
          ? ['transparent', 'rgba(99, 102, 241, 0.08)', 'rgba(139, 92, 246, 0.05)', 'transparent']
          : ['transparent', 'rgba(99, 102, 241, 0.05)', 'rgba(139, 92, 246, 0.03)', 'transparent']
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View style={[StyleSheet.absoluteFill, { opacity: sparkleAnim }]}>
        <FourPointStar style={{ top: 40, left: 30 }} size={14} color={isDark ? 'rgba(255,255,255,0.7)' : 'rgba(99,102,241,0.4)'} />
        <Star style={{ top: 80, left: 70 }} size={4} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(99,102,241,0.3)'} />
        <Star style={{ top: 60, right: 50 }} size={6} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(139,92,246,0.35)'} />
        <FourPointStar style={{ top: 100, right: 35 }} size={12} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(99,102,241,0.3)'} />
        <Star style={{ top: 130, left: 45 }} size={3} color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(139,92,246,0.25)'} />
        <Star style={{ top: 70, left: SCREEN_WIDTH * 0.45 }} size={5} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(99,102,241,0.3)'} />
        <Star style={{ top: 150, right: 80 }} size={4} color={isDark ? 'rgba(255,255,255,0.45)' : 'rgba(139,92,246,0.25)'} />
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.subtract(1, sparkleAnim) }]}>
        <Star style={{ top: 50, left: 50 }} size={5} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(99,102,241,0.3)'} />
        <FourPointStar style={{ top: 85, right: 40 }} size={16} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(139,92,246,0.35)'} />
        <Star style={{ top: 120, left: 30 }} size={4} color={isDark ? 'rgba(255,255,255,0.45)' : 'rgba(99,102,241,0.25)'} />
        <Star style={{ top: 75, left: SCREEN_WIDTH * 0.55 }} size={6} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(139,92,246,0.3)'} />
        <FourPointStar style={{ top: 35, right: 90 }} size={10} color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(99,102,241,0.25)'} />
        <Star style={{ top: 140, right: 55 }} size={3} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(139,92,246,0.25)'} />
        <Star style={{ top: 95, left: 90 }} size={5} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(99,102,241,0.3)'} />
      </Animated.View>

      <View style={starStyles.content}>
        <Animated.View style={{ transform: [{ rotate: rotation }] }}>
          <GlowingStar size={36} color={starColor} glowColor={glowColor} pulseAnim={pulseAnim} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

// Empty state with stars
function EmptyCatalogs({ colors, isDark, isManager }: { colors: any; isDark: boolean; isManager: boolean }) {
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
    <Animated.View style={[starStyles.container, { backgroundColor: isDark ? '#09090b' : colors.background, opacity: fadeAnim }]}>
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

      {/* Content */}
      <View style={starStyles.content}>
        <View style={[starStyles.iconContainer, {
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(99,102,241,0.1)',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(99,102,241,0.15)'
        }]}>
          <Ionicons name="grid-outline" size={44} color={isDark ? 'rgba(255,255,255,0.95)' : colors.primary} />
        </View>
        <Text style={[starStyles.title, { color: isDark ? '#fff' : colors.text }]} maxFontSizeMultiplier={1.2}>
          No Menus Available
        </Text>
        <Text style={[starStyles.subtitle, { color: isDark ? 'rgba(255,255,255,0.55)' : colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
          {isManager
            ? 'Create your product menu in the Vendor Portal to start selling with preset items and prices.'
            : 'Ask your manager to create a menu for you to get started.'}
        </Text>
        {isManager && (
          <TouchableOpacity
            style={[starStyles.button, { backgroundColor: isDark ? '#fff' : '#09090b' }]}
            onPress={() => openVendorDashboard('/products')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Open Vendor Portal"
            accessibilityHint="Opens the vendor dashboard to create menus"
          >
            <Text style={[starStyles.buttonText, { color: isDark ? '#09090b' : '#fff' }]} maxFontSizeMultiplier={1.3}>
              Open Vendor Portal
            </Text>
            <Ionicons name="arrow-forward" size={18} color={isDark ? '#09090b' : '#fff'} />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

const starStyles = StyleSheet.create({
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
  const glassColors = isDark ? glass.dark : glass.light;
  const { catalogs, selectedCatalog, setSelectedCatalog, refreshCatalogs, isLoading } = useCatalog();
  const isManager = user?.role === 'owner' || user?.role === 'admin';

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

  const styles = createStyles(colors, glassColors);

  const renderCatalog = ({ item }: { item: Catalog }) => {
    const isSelected = selectedCatalog?.id === item.id;

    return (
      <TouchableOpacity
        style={[styles.catalogCard, isSelected && styles.catalogCardSelected]}
        onPress={() => handleSelectCatalog(item)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${item.productCount} ${item.productCount === 1 ? 'product' : 'products'}${isSelected ? ', selected' : ''}`}
        accessibilityHint="Double tap to select this menu"
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
            {item.productCount} {item.productCount === 1 ? 'product' : 'products'}
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
          <Text style={styles.title} maxFontSizeMultiplier={1.2}>{isModal ? 'Switch Menu' : 'Select a Menu'}</Text>
          <Text style={styles.subtitle} maxFontSizeMultiplier={1.5}>
            {isModal
              ? 'Choose a different menu for this device'
              : 'Choose which menu to use for this session'}
          </Text>
        </View>
        {isModal && (
          <TouchableOpacity style={styles.closeButton} onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close">
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

const createStyles = (colors: any, glassColors: typeof glass.dark) => {
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
      backgroundColor: glassColors.backgroundSubtle,
      borderBottomWidth: 1,
      borderBottomColor: glassColors.borderSubtle,
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
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: glassColors.border,
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
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: glassColors.border,
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
