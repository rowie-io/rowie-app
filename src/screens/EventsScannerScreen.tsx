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
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useDevice } from '../context/DeviceContext';
import { useSocket } from '../context/SocketContext';
import { eventsApi, type OrgEvent, type RecentScan } from '../lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
          message: 'Ticket verified',
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
        tierName: result.tierName || 'Unknown',
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
        tierName: 'Unknown',
        timestamp: new Date(),
        valid: false,
        message: err?.error || 'Failed to verify ticket',
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
          {/* Header - always visible */}
          <View style={styles.selectHeader}>
          <Text style={[styles.selectTitle, { color: colors.text }]} maxFontSizeMultiplier={1.2}>Ticket Scanner</Text>
          <Text style={[styles.selectSubtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
            Select an event to start scanning
          </Text>
        </View>

        {/* Content area */}
        {isLoading ? (
          // Skeleton loading
          <View style={styles.skeletonContainer}>
            {[1, 2, 3].map((i) => (
              <View key={i} style={[styles.skeletonCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.skeletonContent}>
                  <View style={[styles.skeletonTitle, { backgroundColor: colors.border }]} />
                  <View style={[styles.skeletonSubtitle, { backgroundColor: colors.border }]} />
                  <View style={styles.skeletonStats}>
                    <View style={[styles.skeletonStat, { backgroundColor: colors.border }]} />
                    <View style={[styles.skeletonStat, { backgroundColor: colors.border }]} />
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : eventsError ? (
          // Error state
          <View style={styles.emptyStateContainer}>
            <View style={[styles.emptyIconContainer, { backgroundColor: colors.error + '15' }]}>
              <Ionicons name="alert-circle-outline" size={32} color={colors.error} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              Unable to Load Events
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
              Please check your connection and try again
            </Text>
          </View>
        ) : activeEvents.length === 0 ? (
          // No events
          <View style={styles.emptyStateContainer}>
            <View style={[styles.emptyIconContainer, { backgroundColor: colors.textMuted + '10' }]}>
              <Ionicons name="calendar-outline" size={32} color={colors.textMuted} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              No Active Events
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
              Create and publish an event from the{'\n'}vendor dashboard to start scanning tickets
            </Text>
          </View>
        ) : (
          <FlatList
            data={activeEvents}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.eventList}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.eventCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setSelectedEvent(item)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${item.ticketsSold} tickets sold, ${item.ticketsScanned ?? 0} scanned`}
                accessibilityHint="Double tap to start scanning for this event"
              >
                <View style={styles.eventCardContent}>
                  <Text style={[styles.eventName, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                    {item.name}
                  </Text>
                  <Text style={[styles.eventDate, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                    {formatEventDateTime(item)}
                  </Text>
                  <View style={styles.eventStats}>
                    <View style={styles.eventStat}>
                      <Ionicons name="ticket-outline" size={14} color={colors.textMuted} />
                      <Text style={[styles.eventStatText, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                        {item.ticketsSold} sold
                      </Text>
                    </View>
                    <View style={styles.eventStat}>
                      <Ionicons name="scan-outline" size={14} color={colors.textMuted} />
                      <Text style={[styles.eventStatText, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                        {item.ticketsScanned ?? 0} scanned
                      </Text>
                    </View>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            )}
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
            <TouchableOpacity onPress={() => setSelectedEvent(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }} accessibilityRole="button" accessibilityLabel="Back to event selection">
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: 15 }} maxFontSizeMultiplier={1.3}>Back</Text>
            </TouchableOpacity>
            <Text style={[styles.selectTitle, { color: colors.text }]} maxFontSizeMultiplier={1.2}>{selectedEvent.name}</Text>
            <Text style={[styles.selectSubtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
              {!CameraView ? 'Camera module not available' : 'Camera permission required to scan tickets'}
            </Text>
          </View>
          {!CameraView ? (
            <View style={styles.emptyStateContainer}>
              <View style={[styles.emptyIconContainer, { backgroundColor: colors.textMuted + '15' }]}>
                <Ionicons name="camera-outline" size={32} color={colors.textMuted} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>Camera Not Available</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                The camera module is not installed.{'\n'}Please use a development build.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyStateContainer}>
              <View style={[styles.emptyIconContainer, { backgroundColor: colors.primary + '15' }]}>
                <Ionicons name="camera-outline" size={32} color={colors.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>Camera Access Required</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                To scan ticket QR codes, please allow{'\n'}camera access for Rowie
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={requestPermission}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Enable Camera"
                accessibilityHint="Grant camera permission to scan QR codes"
              >
                <LinearGradient
                  colors={[colors.primary, '#D97706']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.primaryButtonGradient}
                >
                  <Ionicons name="camera" size={18} color="#fff" />
                  <Text style={styles.primaryButtonText} maxFontSizeMultiplier={1.3}>Enable Camera</Text>
                </LinearGradient>
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
      <View style={[styles.overlay, { paddingTop: insets.top + 16 }]}>
        {/* Top section: Header + Scan area */}
        <View style={styles.topSection}>
          {/* Header with selected event */}
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
              accessibilityLabel={`Scanning ${selectedEvent.name}. Tap to change event`}
            >
              <View style={styles.eventSelectorContent}>
                <Text style={styles.headerTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>{selectedEvent.name}</Text>
                <Text style={styles.headerSubtitle} maxFontSizeMultiplier={1.5}>
                  {selectedEvent.ticketsScanned ?? 0}/{selectedEvent.ticketsSold} scanned · Tap to change
                </Text>
              </View>
              <Ionicons name="swap-horizontal" size={20} color="rgba(255,255,255,0.6)" />
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
              {processing ? 'Verifying...' : 'Point camera at ticket QR code'}
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
              accessibilityLabel={`${lastScan.valid ? 'Valid Ticket' : 'Invalid Ticket'}. ${lastScan.message || ''}${lastScan.customerName ? `, ${lastScan.customerName}` : ''}`}
            >
              <Ionicons
                name={lastScan.valid ? 'checkmark-circle' : 'close-circle'}
                size={32}
                color={lastScan.valid ? '#10B981' : '#EF4444'}
              />
              <View style={styles.resultInfo}>
                <Text style={styles.resultTitle} maxFontSizeMultiplier={1.3}>
                  {lastScan.valid ? 'Valid Ticket' : 'Invalid'}
                </Text>
                <Text style={styles.resultMessage} maxFontSizeMultiplier={1.5}>
                  {lastScan.message}
                </Text>
                {lastScan.customerName && (
                  <Text style={styles.resultDetail} maxFontSizeMultiplier={1.5}>
                    {lastScan.customerName}
                  </Text>
                )}
                {lastScan.tierName && lastScan.tierName !== 'Unknown' && (
                  <Text style={styles.resultDetail} maxFontSizeMultiplier={1.5}>
                    {lastScan.tierName}
                  </Text>
                )}
                {lastScan.ticketEvent && (
                  <Text style={styles.resultDetail} maxFontSizeMultiplier={1.5}>
                    Ticket is for: {lastScan.ticketEvent}
                  </Text>
                )}
              </View>
            </Animated.View>
          )}
        </View>

        {/* Recent scans - always visible at bottom */}
        <View style={[styles.recentContainer, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.recentTitle} maxFontSizeMultiplier={1.5}>
            Recent Scans {recentScans.length > 0 ? `(${recentScans.length})` : ''}
          </Text>
          {loadingScans ? (
            <View style={styles.emptyScans}>
              <Text style={styles.emptyScansText} maxFontSizeMultiplier={1.5}>Loading scans...</Text>
            </View>
          ) : recentScans.length === 0 ? (
            <View style={styles.emptyScans}>
              <Text style={styles.emptyScansText} maxFontSizeMultiplier={1.5}>No scans yet</Text>
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
  // Empty state styles (shared)
  emptyStateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    opacity: 0.8,
  },
  // Skeleton loading styles
  skeletonContainer: {
    paddingHorizontal: 20,
    gap: 12,
  },
  skeletonCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  skeletonContent: {
    gap: 12,
  },
  skeletonTitle: {
    height: 18,
    width: '60%',
    borderRadius: 8,
  },
  skeletonSubtitle: {
    height: 14,
    width: '40%',
    borderRadius: 6,
  },
  skeletonStats: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 4,
  },
  skeletonStat: {
    height: 12,
    width: 70,
    borderRadius: 6,
  },
  // Buttons
  primaryButton: {
    marginTop: 24,
    borderRadius: 14,
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
    fontWeight: '600',
  },
  // Event selection styles
  selectHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  selectTitle: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  selectSubtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  eventList: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  eventCardContent: {
    flex: 1,
  },
  eventName: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  eventDate: {
    fontSize: 14,
    marginBottom: 8,
  },
  eventStats: {
    flexDirection: 'row',
    gap: 16,
  },
  eventStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  eventStatText: {
    fontSize: 13,
  },
  // Scanner overlay styles
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topSection: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  eventSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 12,
  },
  eventSelectorContent: {
    flex: 1,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 2,
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
    width: 24,
    height: 24,
    borderColor: '#F59E0B',
    borderWidth: 3,
  },
  topLeft: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  topRight: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  bottomLeft: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  bottomRight: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  scanHint: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
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
    fontWeight: '700',
  },
  resultMessage: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    marginTop: 2,
  },
  resultDetail: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 2,
  },
  recentContainer: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    maxHeight: 220,
  },
  recentList: {
    maxHeight: 150,
  },
  recentTitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  recentName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  recentMeta: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    marginTop: 2,
  },
  emptyScans: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyScansText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 14,
  },
});
