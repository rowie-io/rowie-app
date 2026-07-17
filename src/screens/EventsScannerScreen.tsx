import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Animated,
  Dimensions,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { EmptyState } from '../components/EmptyState';
import { useDevice } from '../context/DeviceContext';
import { useSocket, useSocketEvent, SocketEvents } from '../context/SocketContext';
import { eventsApi, type OrgEvent, type RecentScan } from '../lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fonts } from '../lib/fonts';
import { useTranslations } from '../lib/i18n';
import * as Haptics from 'expo-haptics';

// Minimum gap between two camera reads firing the API. Kept short (one frame
// of breathing room) — the per-code dedupe set is what actually prevents
// spam, so door staff can work a queue at full speed.
const SCAN_COOLDOWN_MS = 400;

// Ticket QR payloads are randomBytes(32).toString('hex') — 64 hex chars
// (see rowie-api events.ts generateQrCode). Anything else in frame is a
// foreign QR (loyalty card, URL, boarding pass) and is ignored silently.
const TICKET_CODE_REGEX = /^[0-9a-f]{64}$/i;

// AsyncStorage key for the scanner feedback mute preference.
const SCANNER_FEEDBACK_MUTED_KEY = 'rowie_scanner_feedback_muted';

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

type ScanOutcome =
  | 'valid'
  | 'already_used'
  | 'invalid'
  | 'wrong_event'
  | 'event_cancelled'
  | 'network_error';

interface ScanRecord {
  id: string;
  outcome: ScanOutcome;
  customerName: string | null;
  tierName: string;
  timestamp: Date;
  valid: boolean;
  message?: string;
  ticketEvent?: string;
}

// Full-screen wash styling per outcome. Green = in, red = stop, amber =
// wrong event (redirect, not fraud), stone = we simply couldn't verify.
const WASH_STYLES: Record<ScanOutcome, { bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  valid: { bg: 'rgba(4, 120, 87, 0.92)', icon: 'checkmark-circle' },
  already_used: { bg: 'rgba(185, 28, 28, 0.92)', icon: 'close-circle' },
  invalid: { bg: 'rgba(185, 28, 28, 0.92)', icon: 'close-circle' },
  wrong_event: { bg: 'rgba(180, 83, 9, 0.92)', icon: 'swap-horizontal-outline' },
  event_cancelled: { bg: 'rgba(185, 28, 28, 0.92)', icon: 'calendar-outline' },
  network_error: { bg: 'rgba(41, 37, 36, 0.94)', icon: 'cloud-offline-outline' },
};

function formatEventDateTime(event: OrgEvent): string {
  const start = new Date(event.startsAt);
  return start.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface EventSelectCardProps {
  event: OrgEvent;
  colors: any;
  t: Translate;
  onSelect: (event: OrgEvent) => void;
}

// Memoized event row for the selection list — extracted so socket-driven event
// updates only re-render the changed card instead of the whole list.
const EventSelectCard = React.memo(function EventSelectCard({ event, colors, t, onSelect }: EventSelectCardProps) {
  const scanned = event.ticketsScanned ?? 0;
  const sold = event.ticketsSold || 0;
  const progress = sold > 0 ? scanned / sold : 0;

  return (
    <TouchableOpacity
      style={[styles.eventCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => onSelect(event)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={t('eventAccessibilityLabel', { name: event.name, sold: String(sold), scanned: String(scanned) })}
    >
      <View style={styles.eventCardContent}>
        <Text style={[styles.eventName, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {event.name}
        </Text>
        <Text style={[styles.eventDate, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
          {formatEventDateTime(event)}
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
});

// Memoized recent-scan row for the scanner overlay list.
const RecentScanRow = React.memo(function RecentScanRow({ scan }: { scan: ScanRecord }) {
  return (
    <View style={styles.recentItem}>
      <Ionicons
        name={scan.valid ? 'checkmark-circle' : 'close-circle'}
        size={20}
        color={scan.valid ? '#10B981' : '#EF4444'}
      />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={styles.recentName} maxFontSizeMultiplier={1.5}>
          {scan.customerName || scan.message}
        </Text>
        <Text style={styles.recentMeta} maxFontSizeMultiplier={1.5}>
          {scan.tierName ? `${scan.tierName} · ` : ''}{scan.timestamp.toLocaleTimeString()}
        </Text>
      </View>
    </View>
  );
});

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
  const tc = useTranslations('common');

  const [selectedEvent, setSelectedEvent] = useState<OrgEvent | null>(null);
  const [lastScan, setLastScan] = useState<ScanRecord | null>(null);
  const [recentScans, setRecentScans] = useState<ScanRecord[]>([]);
  const [loadingScans, setLoadingScans] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [feedbackMuted, setFeedbackMuted] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualCode, setManualCode] = useState('');
  // Each unique QR code is processed at most once per event session. Prior
  // implementation used a single-string ref reset on a 3s timer, so holding
  // a code in frame would re-fire after the result animation and spam the
  // door staff with "already scanned" / "failed to verify" cards.
  const seenCodesRef = useRef<Set<string>>(new Set());
  // Hard floor between any two API calls, even for distinct codes.
  const cooldownUntilRef = useRef<number>(0);
  // Mirror of feedbackMuted for use inside stable callbacks.
  const feedbackMutedRef = useRef(false);

  // Keep a ref to the selected event so socket handlers stay stable across
  // event selection (no re-subscribe loop — see CLAUDE.md socket rules).
  const selectedEventRef = useRef<OrgEvent | null>(selectedEvent);
  useEffect(() => {
    selectedEventRef.current = selectedEvent;
  }, [selectedEvent]);

  // Load the persisted mute preference once.
  useEffect(() => {
    AsyncStorage.getItem(SCANNER_FEEDBACK_MUTED_KEY)
      .then((v) => {
        if (v === 'true') {
          feedbackMutedRef.current = true;
          setFeedbackMuted(true);
        }
      })
      .catch(() => {});
  }, []);

  const toggleFeedbackMuted = useCallback(() => {
    setFeedbackMuted((prev) => {
      const next = !prev;
      feedbackMutedRef.current = next;
      AsyncStorage.setItem(SCANNER_FEEDBACK_MUTED_KEY, String(next)).catch(() => {});
      return next;
    });
  }, []);

  // Distinct success/failure feedback. No audio library ships with this app
  // (expo-av / expo-audio are not installed), so strong notification haptics
  // stand in for scan sounds. Gated by the mute toggle in the overlay.
  const notifyFeedback = useCallback((kind: 'success' | 'warning' | 'error') => {
    if (feedbackMutedRef.current) return;
    const type =
      kind === 'success'
        ? Haptics.NotificationFeedbackType.Success
        : kind === 'warning'
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Error;
    Haptics.notificationAsync(type).catch(() => {});
  }, []);

  const fetchRecentScans = useCallback(async (eventId: string) => {
    setLoadingScans(true);
    try {
      const response = await eventsApi.getRecentScans(eventId, deviceId, 20);
      const scans: ScanRecord[] = response.scans.map((s: RecentScan) => ({
        id: s.id,
        outcome: 'valid' as ScanOutcome,
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
  }, [deviceId, t]);

  // Fetch recent scans when event is selected
  useEffect(() => {
    // Reset per-code dedupe whenever the active event changes — a code that
    // was scanned for last weekend's event must be allowed to scan today's.
    seenCodesRef.current = new Set();
    cooldownUntilRef.current = 0;

    if (!selectedEvent) {
      setRecentScans([]);
      return;
    }

    fetchRecentScans(selectedEvent.id);
  }, [selectedEvent, fetchRecentScans]);

  // Live-update from other devices: the API emits TICKET_SCANNED /
  // TICKET_PURCHASED / TICKET_REFUNDED to the org room. Refresh the events
  // list (sold/scanned counts) and, when the scan is for the event currently
  // being worked, the recent-scans list too.
  const handleTicketEvent = useCallback((data: any) => {
    queryClient.invalidateQueries({ queryKey: ['events'] });
    const current = selectedEventRef.current;
    if (current && data?.eventId === current.id) {
      fetchRecentScans(current.id);
    }
  }, [queryClient, fetchRecentScans]);

  useSocketEvent(SocketEvents.TICKET_SCANNED, handleTicketEvent);
  useSocketEvent(SocketEvents.TICKET_PURCHASED, handleTicketEvent);
  useSocketEvent(SocketEvents.TICKET_REFUNDED, handleTicketEvent);

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

  const showResult = useCallback((record: ScanRecord, options?: { addToRecent?: boolean }) => {
    setLastScan(record);
    if (options?.addToRecent !== false) {
      setRecentScans(prev => [record, ...prev].slice(0, 20));
    }

    // Full-screen wash: fast in, ~1.2s hold, fast out. Long enough to be
    // unmistakable across a doorway, short enough not to slow the queue.
    Animated.sequence([
      Animated.timing(resultAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.delay(1200),
      Animated.timing(resultAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setLastScan(null);
    });
  }, [resultAnim]);

  // Shared verification path for camera reads and manual entry.
  const runScan = useCallback(async (code: string) => {
    const event = selectedEventRef.current;
    if (!event) return;

    setProcessing(true);
    try {
      const result = await eventsApi.scan(code, event.id, deviceId);

      // Categorise the API outcome. Every reason the API can return gets
      // distinct on-screen feedback (VALID / ALREADY_USED / WRONG_EVENT /
      // EVENT_CANCELLED / INVALID) — only foreign, non-ticket QR payloads
      // are dropped silently before we ever get here.
      const outcome: ScanOutcome = result.valid
        ? 'valid'
        : result.reason === 'ALREADY_USED'
          ? 'already_used'
          : result.reason === 'WRONG_EVENT'
            ? 'wrong_event'
            : result.reason === 'EVENT_CANCELLED'
              ? 'event_cancelled'
              : 'invalid';

      notifyFeedback(outcome === 'valid' ? 'success' : outcome === 'wrong_event' ? 'warning' : 'error');

      showResult({
        id: Date.now().toString(),
        outcome,
        customerName: result.customerName ?? null,
        tierName: result.tierName || t('unknownTier'),
        timestamp: new Date(),
        valid: result.valid === true,
        message: result.message,
        ticketEvent: result.ticketEvent,
      });
    } catch {
      // Network / HTTP failure — nothing was verified. Release the dedupe
      // slot so re-presenting the same ticket retries immediately, and show
      // a neutral "couldn't verify" wash instead of staying silent.
      seenCodesRef.current.delete(code);
      notifyFeedback('warning');
      showResult({
        id: Date.now().toString(),
        outcome: 'network_error',
        customerName: null,
        tierName: '',
        timestamp: new Date(),
        valid: false,
        message: t('washNetworkErrorMessage'),
      }, { addToRecent: false });
    } finally {
      setProcessing(false);
    }
  }, [deviceId, notifyFeedback, showResult, t]);

  const handleBarCodeScanned = useCallback(async ({ data }: { data: string }) => {
    if (!selectedEvent || processing) return;
    // Per-code dedupe: each unique QR is processed at most once per event
    // session. The camera fires onBarcodeScanned at frame rate while a code
    // is in view, so this is what stops the spam.
    if (seenCodesRef.current.has(data)) return;
    // Short pacing floor between distinct codes so back-to-back frames of
    // different QRs can't double-fire mid-animation.
    const now = Date.now();
    if (now < cooldownUntilRef.current) return;

    seenCodesRef.current.add(data);
    cooldownUntilRef.current = now + SCAN_COOLDOWN_MS;

    // Light haptic on every read so staff know the camera "saw" the code,
    // even for foreign QRs that are otherwise ignored.
    Haptics.selectionAsync().catch(() => {});

    // Foreign QR payloads (loyalty cards, URLs, random codes) don't look like
    // tickets at all — stay silent for those. Everything ticket-shaped gets
    // explicit feedback from runScan.
    if (!TICKET_CODE_REGEX.test(data)) return;

    await runScan(data);
  }, [processing, selectedEvent, runScan]);

  const submitManualCode = useCallback(() => {
    const code = manualCode.trim();
    if (!code || processing) return;
    setShowManualEntry(false);
    setManualCode('');
    // Manual entry is an explicit retry path — bypass per-code dedupe so
    // staff can re-verify a code the camera already consumed and get the
    // API's authoritative answer.
    runScan(code);
  }, [manualCode, processing, runScan]);

  // Format event date/time for display
  const washTitle = (outcome: ScanOutcome): string => {
    switch (outcome) {
      case 'valid':
        return t('resultValidTitle');
      case 'already_used':
        return t('washAlreadyUsedTitle');
      case 'wrong_event':
        return t('washWrongEventTitle');
      case 'event_cancelled':
        return t('washEventCancelledTitle');
      case 'network_error':
        return t('washNetworkErrorTitle');
      default:
        return t('resultInvalidTitle');
    }
  };

  // Show skeleton while auth or events are loading (and no cached data)
  const isLoading = isInitializing || (eventsLoading && !eventsData);

  // Stable handlers + renderItems so the memoized list rows aren't re-rendered
  // on every socket-driven refresh.
  const handleSelectEvent = useCallback((event: OrgEvent) => setSelectedEvent(event), []);
  const renderEventCard = useCallback(
    ({ item }: { item: OrgEvent }) => (
      <EventSelectCard event={item} colors={colors} t={t} onSelect={handleSelectEvent} />
    ),
    [colors, t, handleSelectEvent],
  );
  const renderRecentScan = useCallback(
    ({ item }: { item: ScanRecord }) => <RecentScanRow scan={item} />,
    [],
  );

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
              renderItem={renderEventCard}
              removeClippedSubviews
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
                  <Ionicons name="camera" size={18} color={colors.onPrimary} />
                  <Text style={styles.primaryButtonText} maxFontSizeMultiplier={1.3}>{t('enableCameraButtonText')}</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  }

  const washStyle = lastScan ? WASH_STYLES[lastScan.outcome] : null;

  return (
    <View style={[styles.container, { backgroundColor: '#0C0A09' }]}>
      {/* Camera */}
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torchOn}
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
                // The seen-codes set is reset by the selectedEvent effect.
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
              <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.85)" />
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

            {/* Torch / manual entry / feedback controls */}
            <View style={styles.controlsRow}>
              <TouchableOpacity
                style={[styles.controlButton, torchOn && styles.controlButtonActive]}
                onPress={() => setTorchOn((v) => !v)}
                accessibilityRole="switch"
                accessibilityState={{ checked: torchOn }}
                accessibilityLabel={torchOn ? t('torchOffAccessibilityLabel') : t('torchOnAccessibilityLabel')}
              >
                <Ionicons name={torchOn ? 'flashlight' : 'flashlight-outline'} size={22} color={torchOn ? '#F59E0B' : '#fff'} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.controlButton}
                onPress={() => setShowManualEntry(true)}
                accessibilityRole="button"
                accessibilityLabel={t('manualEntryAccessibilityLabel')}
              >
                <Ionicons name="keypad-outline" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.controlButton, feedbackMuted && styles.controlButtonActive]}
                onPress={toggleFeedbackMuted}
                accessibilityRole="switch"
                accessibilityState={{ checked: !feedbackMuted }}
                accessibilityLabel={feedbackMuted ? t('feedbackUnmuteAccessibilityLabel') : t('feedbackMuteAccessibilityLabel')}
              >
                <Ionicons name={feedbackMuted ? 'notifications-off-outline' : 'notifications-outline'} size={22} color={feedbackMuted ? '#F59E0B' : '#fff'} />
              </TouchableOpacity>
            </View>
          </View>
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
              renderItem={renderRecentScan}
              style={styles.recentList}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>

        {/* Full-screen result wash — unmistakable at arm's length */}
        {lastScan && washStyle && (
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.wash,
              { opacity: resultAnim, backgroundColor: washStyle.bg },
            ]}
            accessibilityRole="alert"
            accessibilityLabel={`${washTitle(lastScan.outcome)}. ${lastScan.message || ''}${lastScan.customerName ? `, ${lastScan.customerName}` : ''}`}
          >
            <Ionicons name={washStyle.icon} size={120} color="#fff" />
            <Text style={styles.washTitle} maxFontSizeMultiplier={1.2}>
              {washTitle(lastScan.outcome)}
            </Text>
            {lastScan.message ? (
              <Text style={styles.washMessage} maxFontSizeMultiplier={1.3}>{lastScan.message}</Text>
            ) : null}
            {lastScan.customerName ? (
              <Text style={styles.washDetail} maxFontSizeMultiplier={1.3}>{lastScan.customerName}</Text>
            ) : null}
            {lastScan.tierName && lastScan.tierName !== t('unknownTier') ? (
              <Text style={styles.washDetail} maxFontSizeMultiplier={1.3}>{lastScan.tierName}</Text>
            ) : null}
            {lastScan.ticketEvent ? (
              <Text style={styles.washDetail} maxFontSizeMultiplier={1.3}>
                {t('ticketIsForPrefix', { eventName: lastScan.ticketEvent })}
              </Text>
            ) : null}
          </Animated.View>
        )}
      </View>

      {/* Manual ticket code entry */}
      <Modal
        visible={showManualEntry}
        transparent
        animationType="fade"
        onRequestClose={() => setShowManualEntry(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.manualOverlay}
        >
          <View style={styles.manualCard}>
            <Text style={styles.manualTitle} maxFontSizeMultiplier={1.3}>{t('manualEntryTitle')}</Text>
            <Text style={styles.manualSubtitle} maxFontSizeMultiplier={1.5}>{t('manualEntrySubtitle')}</Text>
            <TextInput
              value={manualCode}
              onChangeText={setManualCode}
              placeholder={t('manualEntryPlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={styles.manualInput}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="go"
              onSubmitEditing={submitManualCode}
              accessibilityLabel={t('manualEntryPlaceholder')}
            />
            <View style={styles.manualButtons}>
              <TouchableOpacity
                style={styles.manualCancelButton}
                onPress={() => { setShowManualEntry(false); setManualCode(''); }}
                accessibilityRole="button"
                accessibilityLabel={tc('cancel')}
              >
                <Text style={styles.manualCancelText} maxFontSizeMultiplier={1.3}>{tc('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.manualSubmitButton, (!manualCode.trim() || processing) && { opacity: 0.5 }]}
                onPress={submitManualCode}
                disabled={!manualCode.trim() || processing}
                accessibilityRole="button"
                accessibilityLabel={t('manualEntrySubmit')}
                accessibilityState={{ disabled: !manualCode.trim() || processing }}
              >
                <Text style={styles.manualSubmitText} maxFontSizeMultiplier={1.3}>{t('manualEntrySubmit')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    // Dark stone on amber fill — white fails contrast (see colors.onPrimary)
    color: '#1C1917',
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
    minHeight: 44,
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    fontFamily: fonts.semiBold,
  },
  headerCount: {
    color: 'rgba(255,255,255,0.85)',
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
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    fontFamily: fonts.medium,
    marginTop: 20,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 16,
  },
  controlButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonActive: {
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.7)',
  },
  // Full-screen result wash
  wash: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 6,
  },
  washTitle: {
    color: '#fff',
    fontSize: 32,
    fontFamily: fonts.bold,
    textAlign: 'center',
    marginTop: 8,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  washMessage: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 17,
    fontFamily: fonts.medium,
    textAlign: 'center',
  },
  washDetail: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    fontFamily: fonts.regular,
    textAlign: 'center',
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
    color: 'rgba(255,255,255,0.85)',
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
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontFamily: fonts.regular,
    marginTop: 2,
  },
  emptyScans: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyScansText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontFamily: fonts.regular,
  },
  // Manual entry modal
  manualOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  manualCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#1C1917',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#44403C',
    padding: 24,
  },
  manualTitle: {
    color: '#F5F5F4',
    fontSize: 18,
    fontFamily: fonts.semiBold,
    textAlign: 'center',
  },
  manualSubtitle: {
    color: '#A8A29E',
    fontSize: 14,
    fontFamily: fonts.regular,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 20,
  },
  manualInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#44403C',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: '#F5F5F4',
    minHeight: 48,
  },
  manualButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  manualCancelButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#44403C',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  manualCancelText: {
    color: '#F5F5F4',
    fontSize: 16,
    fontFamily: fonts.medium,
  },
  manualSubmitButton: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  manualSubmitText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: fonts.semiBold,
  },
});
