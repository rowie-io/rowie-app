import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Animated,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { EmptyState } from '../components/EmptyState';
import { useDevice } from '../context/DeviceContext';
import { useSocket } from '../context/SocketContext';
import { eventsApi, type OrgEvent, type RecentScan } from '../lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fonts } from '../lib/fonts';
import { useTranslations } from '../lib/i18n';
// Dynamically import expo-camera (may not be installed)
let CameraView: any = null;
let useCameraPermissions: any = null;
try {
  const mod = require('expo-camera');
  CameraView = mod.CameraView;
  useCameraPermissions = mod.useCameraPermissions;
} catch {
  // expo-camera not installed
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SCAN_AREA_SIZE = SCREEN_WIDTH * 0.65;

interface ScanRecord {
  id: string;
  customerName: string | null;
  tierName: string;
  timestamp: Date;
  valid: boolean;
  message?: string;
  ticketEvent?: string;
}

export function EventsScannerScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { subscription, isLoading: authLoading } = useAuth();
  const { deviceId } = useDevice();
  const { isConnected } = useSocket();
  const queryClient = useQueryClient();
  const wasConnectedRef = useRef(isConnected);
  const hasEverConnectedRef = useRef(false);
  const t = useTranslations('events');

  const [selectedEvent, setSelectedEvent] = useState<OrgEvent | null>(null);
  const [lastScan, setLastScan] = useState<ScanRecord | null>(null);
  const [recentScans, setRecentScans] = useState<ScanRecord[]>([]);
  const [loadingScans, setLoadingScans] = useState(false);
  const [processing, setProcessing] = useState(false);
  const lastScannedRef = useRef<string>('');

  // Fetch recent scans when event is selected
  useEffect(() => {
    if (!selectedEvent) {
      setRecentScans([]);
      return;
    }

    const fetchRecentScans = async () => {
      setLoadingScans(true);
      try {
        const response = await eventsApi.getRecentScans(selectedEvent.id, deviceId, 20);
        const scans: ScanRecord[] = response.scans.map((s: RecentScan) => ({
          id: s.id,
          customerName: s.customerName,
          tierName: s.tierName,
          timestamp: new Date(s.usedAt),
          valid: true,
          message: t('ticketVerifiedMessage'),
        }));
        setRecentScans(scans);
      } catch (err) {
        // Silently ignore
      } finally {
        setLoadingScans(false);
      }
    };

    fetchRecentScans();
  }, [selectedEvent, deviceId]);

  const resultAnim = useRef(new Animated.Value(0)).current;

  // Camera permissions
  const permissionHook = useCameraPermissions ? useCameraPermissions() : [null, null];
  const [permission, requestPermission] = permissionHook || [null, null];

  // Fetch org events
  const { data: eventsData, isLoading: eventsLoading, error: eventsError } = useQuery({
    queryKey: ['events'],
    queryFn: () => eventsApi.list(),
    staleTime: Infinity,
    placeholderData: () => queryClient.getQueryData(['events']),
  });

  // Refetch on socket REconnect (not initial connection)
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current && hasEverConnectedRef.current) {
      queryClient.invalidateQueries({ queryKey: ['events'] });
    }
    if (isConnected) hasEverConnectedRef.current = true;
    wasConnectedRef.current = isConnected;
  }, [isConnected, queryClient]);

  // Show loading while auth/subscription is loading to prevent flash
  const isInitializing = authLoading || (subscription === undefined && !authLoading);

  // Handle both { events: [...] } and [...] response formats
  const allEvents: OrgEvent[] = Array.isArray(eventsData)
    ? eventsData
    : (eventsData?.events || []);

  // Filter to published events: upcoming, ongoing, or within 24h after ending
  const activeEvents = allEvents.filter((e: OrgEvent) => {
    const isPublished = e.status === 'published';
    const endTime = new Date(e.endsAt).getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    return isPublished && Date.now() < endTime + oneDayMs;
  });

  const showResult = useCallback((record: ScanRecord) => {
    setLastScan(record);
    setRecentScans(prev => [record, ...prev].slice(0, 20));

    Animated.sequence([
      Animated.timing(resultAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.delay(2500),
      Animated.timing(resultAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setLastScan(null);
      lastScannedRef.current = '';
    });
  }, [resultAnim]);

  const handleBarCodeScanned = useCallback(async ({ data }: { data: string }) => {
    if (processing || data === lastScannedRef.current || !selectedEvent) return;

    lastScannedRef.current = data;
    setProcessing(true);

    try {
      const result = await eventsApi.scan(data, selectedEvent.id, deviceId);
      const record: ScanRecord = {
        id: Date.now().toString(),
        customerName: result.customerName ?? null,
        tierName: result.tierName || t('unknownTier'),
        timestamp: new Date(),
        valid: result.valid,
        message: result.message,
        ticketEvent: result.ticketEvent,
      };
      showResult(record);
    } catch (err: any) {
      const record: ScanRecord = {
        id: Date.now().toString(),
        customerName: null,
        tierName: t('unknownTier'),
        timestamp: new Date(),
        valid: false,
        message: err?.error || t('failedToVerifyTicketMessage'),
      };
      showResult(record);
    } finally {
      setProcessing(false);
    }
  }, [processing, showResult, selectedEvent, deviceId]);

  // Format event date/time for display
  const formatEventDateTime = (event: OrgEvent) => {
    const start = new Date(event.startsAt);
    return start.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Show skeleton while auth or events are loading (and no cached data)
  const isLoading = isInitializing || (eventsLoading && !eventsData);

  // Event selection screen (or loading/empty states)
  if (!selectedEvent) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          {/* Header */}
          <View style={styles.selectHeader}>
            <Text style={[styles.selectTitle, { color: colors.text }]} maxFontSizeMultiplier={1.2}>{t('screenTitle')}</Text>
          </View>

          {/* Content area */}
          {isLoading ? (
            <View style={styles.skeletonContainer}>
              {[1, 2, 3].map((i) => (
                <View key={i} style={[styles.skeletonCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.skeletonContent}>
                    <View style={[styles.skeletonTitle, { backgroundColor: colors.border }]} />
                    <View style={[styles.skeletonSubtitle, { backgroundColor: colors.border }]} />
                  </View>
                </View>
              ))}
            </View>
          ) : eventsError ? (
            <EmptyState
              icon="alert-circle-outline"
              title={t('errorLoadTitle')}
              subtitle={t('errorLoadSubtitle')}
              animated={false}
            />
          ) : activeEvents.length === 0 ? (
            <EmptyState
              icon="calendar-outline"
              title={t('noActiveEventsTitle')}
              subtitle={t('noActiveEventsSubtitle')}
            />
          ) : (
            <FlatList
              data={activeEvents}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.eventList}
              renderItem={({ item }) => {
                const scanned = item.ticketsScanned ?? 0;
                const sold = item.ticketsSold || 0;
                const progress = sold > 0 ? scanned / sold : 0;

                return (
                  <TouchableOpacity
                    style={[styles.eventCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => setSelectedEvent(item)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('eventAccessibilityLabel', { name: item.name, sold: String(sold), scanned: String(scanned) })}
                  >
                    <View style={styles.eventCardContent}>
                      <Text style={[styles.eventName, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                        {item.name}
                      </Text>
                      <Text style={[styles.eventDate, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                        {formatEventDateTime(item)}
                      </Text>

                      {/* Progress bar */}
                      <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                        <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: colors.primary }]} />
                      </View>
                      <Text style={[styles.progressText, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                        {t('scannedOfSold', { scanned: String(scanned), sold: String(sold) })}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </View>
    );
  }

  // Camera not available or permission not granted — show inline in scanner view
  if (!CameraView || !permission?.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.selectHeader}>
            <TouchableOpacity onPress={() => setSelectedEvent(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }} accessibilityRole="button" accessibilityLabel={t('backToEventSelectionAccessibilityLabel')}>
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: 15 }} maxFontSizeMultiplier={1.3}>{t('backButtonText')}</Text>
            </TouchableOpacity>
            <Text style={[styles.selectTitle, { color: colors.text }]} maxFontSizeMultiplier={1.2}>{selectedEvent.name}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 15, fontFamily: fonts.regular }} maxFontSizeMultiplier={1.5}>
              {!CameraView ? t('cameraNotAvailableTitle') : t('cameraAccessRequiredTitle')}
            </Text>
          </View>
          {!CameraView ? (
            <View style={styles.emptyStateContainer}>
              <Ionicons name="camera-outline" size={44} color={colors.textMuted} />
              <Text style={[styles.emptyTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{t('cameraNotAvailableTitle')}</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                {t('cameraNotAvailableSubtitle')}
              </Text>
            </View>
          ) : (
            <View style={styles.emptyStateContainer}>
              <Ionicons name="camera-outline" size={44} color={colors.primary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{t('cameraAccessRequiredTitle')}</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                {t('cameraAccessRequiredSubtitle')}
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={requestPermission}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('enableCameraButtonText')}
                accessibilityHint={t('cameraAccessRequiredSubtitle')}
              >
                <View style={[styles.primaryButtonGradient, { backgroundColor: colors.primary }]}>
                  <Ionicons name="camera" size={18} color="#fff" />
                  <Text style={styles.primaryButtonText} maxFontSizeMultiplier={1.3}>{t('enableCameraButtonText')}</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      {/* Camera */}
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={handleBarCodeScanned}
      />

      {/* Overlay */}
      <View style={[styles.overlay, { paddingTop: insets.top + 12 }]}>
        {/* Top section: Header + Scan area */}
        <View style={styles.topSection}>
          {/* Header pill */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.eventSelector}
              onPress={() => {
                setSelectedEvent(null);
                setRecentScans([]);
                lastScannedRef.current = '';
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('eventAccessibilityLabel', { name: selectedEvent.name, sold: String(selectedEvent.ticketsSold), scanned: String(selectedEvent.ticketsScanned ?? 0) })}
            >
              <Ionicons name="radio-button-on" size={10} color="#10B981" />
              <Text style={styles.headerTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>{selectedEvent.name}</Text>
              <Text style={styles.headerCount} maxFontSizeMultiplier={1.3}>
                {selectedEvent.ticketsScanned ?? 0}/{selectedEvent.ticketsSold}
              </Text>
              <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>

          {/* Scan area indicator */}
          <View style={styles.scanAreaContainer}>
            <View style={styles.scanArea}>
              {/* Corner markers */}
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
            <Text style={styles.scanHint} maxFontSizeMultiplier={1.5}>
              {processing ? t('scanHintVerifying') : t('scanHintDefault')}
            </Text>
          </View>

          {/* Result overlay */}
          {lastScan && (
            <Animated.View
              style={[
                styles.resultCard,
                {
                  opacity: resultAnim,
                  transform: [{
                    translateY: resultAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [20, 0],
                    }),
                  }],
                  backgroundColor: lastScan.valid ? '#065F46' : '#7F1D1D',
                  borderColor: lastScan.valid ? '#10B981' : '#EF4444',
                },
              ]}
              accessibilityRole="alert"
              accessibilityLabel={t('resultAccessibilityLabel', { validity: lastScan.valid ? t('resultValidTitle') : t('resultInvalidTitle'), message: lastScan.message || '', customerName: lastScan.customerName ? `, ${lastScan.customerName}` : '' })}
            >
              <Ionicons
                name={lastScan.valid ? 'checkmark-circle' : 'close-circle'}
                size={32}
                color={lastScan.valid ? '#10B981' : '#EF4444'}
              />
              <View style={styles.resultInfo}>
                <Text style={styles.resultTitle} maxFontSizeMultiplier={1.3}>
                  {lastScan.valid ? t('resultValidTitle') : t('resultInvalidTitle')}
                </Text>
                <Text style={styles.resultMessage} maxFontSizeMultiplier={1.5}>
                  {lastScan.message}
                </Text>
                {lastScan.customerName && (
                  <Text style={styles.resultDetail} maxFontSizeMultiplier={1.5}>
                    {lastScan.customerName}
                  </Text>
                )}
                {lastScan.tierName && lastScan.tierName !== t('unknownTier') && (
                  <Text style={styles.resultDetail} maxFontSizeMultiplier={1.5}>
                    {lastScan.tierName}
                  </Text>
                )}
                {lastScan.ticketEvent && (
                  <Text style={styles.resultDetail} maxFontSizeMultiplier={1.5}>
                    {t('ticketIsForPrefix', { eventName: lastScan.ticketEvent })}
                  </Text>
                )}
              </View>
            </Animated.View>
          )}
        </View>

        {/* Recent scans - always visible at bottom */}
        <View style={[styles.recentContainer, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.recentTitle} maxFontSizeMultiplier={1.5}>
            {recentScans.length > 0 ? t('recentScansTitleWithCount', { count: String(recentScans.length) }) : t('recentScansTitle')}
          </Text>
          {loadingScans ? (
            <View style={styles.emptyScans}>
              <Text style={styles.emptyScansText} maxFontSizeMultiplier={1.5}>{t('loadingScansText')}</Text>
            </View>
          ) : recentScans.length === 0 ? (
            <View style={styles.emptyScans}>
              <Text style={styles.emptyScansText} maxFontSizeMultiplier={1.5}>{t('noScansYetText')}</Text>
            </View>
          ) : (
            <FlatList
              data={recentScans.slice(0, 20)}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.recentItem}>
                  <Ionicons
                    name={item.valid ? 'checkmark-circle' : 'close-circle'}
                    size={20}
                    color={item.valid ? '#10B981' : '#EF4444'}
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.recentName} maxFontSizeMultiplier={1.5}>
                      {item.customerName || item.message}
                    </Text>
                    <Text style={styles.recentMeta} maxFontSizeMultiplier={1.5}>
                      {item.tierName} — {item.timestamp.toLocaleTimeString()}
                    </Text>
                  </View>
                </View>
              )}
              style={styles.recentList}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Empty states
  emptyStateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: fonts.semiBold,
    textAlign: 'center',
    marginTop: 4,
  },
  emptySubtitle: {
    fontSize: 15,
    fontFamily: fonts.regular,
    textAlign: 'center',
    lineHeight: 22,
  },
  // Skeleton
  skeletonContainer: {
    paddingHorizontal: 20,
    gap: 12,
  },
  skeletonCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  skeletonContent: {
    gap: 12,
  },
  skeletonTitle: {
    height: 16,
    width: '55%',
    borderRadius: 8,
  },
  skeletonSubtitle: {
    height: 12,
    width: '35%',
    borderRadius: 6,
  },
  // Buttons
  primaryButton: {
    marginTop: 24,
    borderRadius: 12,
    overflow: 'hidden',
  },
  primaryButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 28,
    gap: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: fonts.semiBold,
  },
  // Event selection
  selectHeader: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  selectTitle: {
    fontSize: 28,
    fontFamily: fonts.bold,
    letterSpacing: -0.5,
  },
  eventList: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 12,
  },
  eventCardContent: {
    flex: 1,
  },
  eventName: {
    fontSize: 17,
    fontFamily: fonts.semiBold,
    marginBottom: 3,
  },
  eventDate: {
    fontSize: 14,
    fontFamily: fonts.regular,
    marginBottom: 14,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  // Scanner overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topSection: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  eventSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 8,
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    fontFamily: fonts.semiBold,
  },
  headerCount: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontFamily: fonts.medium,
  },
  scanAreaContainer: {
    alignItems: 'center',
  },
  scanArea: {
    width: SCAN_AREA_SIZE,
    height: SCAN_AREA_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: '#F59E0B',
    borderWidth: 3,
  },
  topLeft: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 10 },
  topRight: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 10 },
  bottomLeft: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 10 },
  bottomRight: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 10 },
  scanHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontFamily: fonts.medium,
    marginTop: 20,
    textAlign: 'center',
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  resultInfo: {
    flex: 1,
    marginLeft: 12,
  },
  resultTitle: {
    color: '#fff',
    fontSize: 17,
    fontFamily: fonts.bold,
  },
  resultMessage: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontFamily: fonts.regular,
    marginTop: 2,
  },
  resultDetail: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontFamily: fonts.regular,
    marginTop: 2,
  },
  recentContainer: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    maxHeight: 240,
  },
  recentList: {
    maxHeight: 170,
  },
  recentTitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    fontFamily: fonts.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  recentName: {
    color: '#fff',
    fontSize: 15,
    fontFamily: fonts.medium,
  },
  recentMeta: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontFamily: fonts.regular,
    marginTop: 2,
  },
  emptyScans: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyScansText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 14,
    fontFamily: fonts.regular,
  },
});
