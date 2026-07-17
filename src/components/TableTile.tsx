import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TableSeats, SEAT_WRAPPER_PAD } from './TableSeats';
import {
  TABLE_STATUS_COLORS,
  type TableStatus,
  deriveTableStatus,
  formatElapsed,
} from '../lib/tableStatus';
import type { Table, Session } from '../lib/api/sessions';
import { fonts } from '../lib/fonts';
import { useTranslations } from '../lib/i18n';

/**
 * Runtime table tile rendered on the floor plan canvas.
 *
 * Toast-five layout: label centered, elapsed-time below when occupied,
 * seats around the perimeter. Status comes from `deriveTableStatus` so the
 * mobile view stays visually identical to the vendor portal's service view.
 *
 * Accessibility: every non-empty state carries a redundant non-color cue —
 * occupied tiles show the elapsed timer + item-count badge, and aging /
 * urgent / check-requested / merged states add a corner glyph — so states
 * survive grayscale and colorblindness.
 */

interface TableTileProps {
  table: Table;
  session: Session | null;
  onPress: () => void;
  /** Long-press handler. Used by FloorPlanScreen to open the per-table action
   *  sheet (Merge / Unmerge / etc.) without bouncing through SessionDetail. */
  onLongPress?: () => void;
  now?: number;
  /** Override the table's native capacity for seat rendering. Primary table
   *  of a merge shows summed capacity; merged secondaries get 0 (no seats). */
  effectiveCapacity?: number;
  /** When set, override status visuals to show this tile as a merge target —
   *  pulsing purple ring + cursor pointer. Tap fires `onPress` which the
   *  parent treats as 'merge into the pending session'. */
  mergeTargetMode?: boolean;
  /** When true, briefly pulse the tile (new items just landed on its session).
   *  Parent clears it after a couple of seconds. */
  pulse?: boolean;
  /** Skip the pulse animation (OS reduce-motion). A static ring still shows. */
  reduceMotion?: boolean;
}

export const TableTile = React.memo(function TableTile({
  table,
  session,
  onPress,
  onLongPress,
  now,
  effectiveCapacity,
  mergeTargetMode,
  pulse,
  reduceMotion,
}: TableTileProps) {
  const t = useTranslations('floorPlan');
  const sessionMeta = session as unknown as {
    checkRequested?: boolean;
    updatedAt?: string;
  } | null;
  const status: TableStatus = deriveTableStatus(
    session
      ? {
          openedAt: session.openedAt,
          lastActivityAt: sessionMeta?.updatedAt,
          checkRequested: sessionMeta?.checkRequested,
        }
      : null,
    now,
    table.status,
  );
  const palette = TABLE_STATUS_COLORS[status];
  const statusLabel = t(`tableStatus_${status}`);
  const hasSession = !!session;
  const isDisabled = !mergeTargetMode && (status === 'merged' || status === 'unavailable');

  const shape =
    table.shape === 'circle' || table.shape === 'square' || table.shape === 'rectangle'
      ? (table.shape as 'circle' | 'square' | 'rectangle')
      : 'rectangle';

  // Enforce a usable minimum even if the vendor editor authored tiny tables —
  // 48px keeps the label + timer legible and the touch target sane.
  const tableW = Math.max(48, table.width || 80);
  const tableH = Math.max(48, table.height || 80);

  const borderRadius =
    shape === 'circle' ? Math.min(tableW, tableH) / 2 : shape === 'square' ? 8 : 12;

  // New-items pulse: 2.5 gentle scale beats when `pulse` flips true. With
  // reduce-motion enabled we skip the animation and rely on the static amber
  // ring (rendered below while `pulse` is true) instead.
  const pulseScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse) return;
    if (reduceMotion) return;
    const beat = Animated.sequence([
      Animated.timing(pulseScale, {
        toValue: 1.08,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(pulseScale, {
        toValue: 1,
        duration: 260,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    const loop = Animated.loop(beat, { iterations: 3 });
    loop.start();
    return () => {
      loop.stop();
      pulseScale.setValue(1);
    };
  }, [pulse, reduceMotion, pulseScale]);

  const cornerIcon = mergeTargetMode ? null : palette.icon;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: (table.x || 0) - SEAT_WRAPPER_PAD,
        top: (table.y || 0) - SEAT_WRAPPER_PAD,
        width: tableW + SEAT_WRAPPER_PAD * 2,
        height: tableH + SEAT_WRAPPER_PAD * 2,
        transform: [{ scale: pulseScale }],
      }}
    >
      <TableSeats
        shape={shape}
        width={tableW}
        height={tableH}
        capacity={effectiveCapacity ?? table.capacity ?? 0}
        color={mergeTargetMode ? '#A855F7' : palette.border}
        opacity={hasSession ? 0.9 : 0.5}
      />
      <TouchableOpacity
        onPress={isDisabled ? undefined : onPress}
        onLongPress={isDisabled ? undefined : onLongPress}
        delayLongPress={350}
        disabled={isDisabled}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={
          mergeTargetMode
            ? t('mergeInto', { label: table.label })
            : hasSession
            ? t(
                (session?.itemCount ?? 0) === 1
                  ? 'tableAccessibilityLabelWithSessionOne'
                  : 'tableAccessibilityLabelWithSession',
                {
                  label: table.label,
                  status: statusLabel,
                  count: session?.itemCount ?? 0,
                }
              )
            : t('tableAccessibilityLabel', { label: table.label, status: statusLabel })
        }
        style={{
          position: 'absolute',
          left: SEAT_WRAPPER_PAD,
          top: SEAT_WRAPPER_PAD,
          width: tableW,
          height: tableH,
          backgroundColor: mergeTargetMode ? 'rgba(168, 85, 247, 0.12)' : palette.fill,
          borderColor: pulse ? '#FBBF24' : mergeTargetMode ? '#A855F7' : palette.border,
          borderWidth: mergeTargetMode || pulse ? 3 : 2,
          borderRadius,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 4,
          opacity: isDisabled ? 0.45 : 1,
        }}
      >
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
          style={[styles.label, { color: palette.text, maxWidth: tableW - 12 }]}
        >
          {table.label}
        </Text>
        {hasSession && session ? (
          <Text
            maxFontSizeMultiplier={1.2}
            style={[styles.timer, { color: palette.text }]}
          >
            {formatElapsed(session.openedAt, now)}
          </Text>
        ) : null}
        {/* Corner status glyph — redundant non-color cue per state. */}
        {cornerIcon && (
          <Ionicons
            name={cornerIcon as keyof typeof Ionicons.glyphMap}
            size={13}
            color={status === 'check_requested' ? palette.text : palette.border}
            style={styles.cornerIcon}
          />
        )}
        {/* Item-count badge — surfaces order volume at floor level so new
            rounds are visible without opening the session. */}
        {hasSession && session && session.itemCount > 0 && !mergeTargetMode && (
          <View
            style={[
              styles.countBadge,
              { backgroundColor: status === 'empty' ? '#44403C' : palette.border },
            ]}
            pointerEvents="none"
          >
            <Text
              maxFontSizeMultiplier={1.2}
              style={[
                styles.countBadgeText,
                { color: status === 'urgent' ? '#FFFFFF' : '#1C1917' },
              ]}
            >
              {session.itemCount > 99 ? '99+' : session.itemCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontFamily: fonts.bold,
    textAlign: 'center',
  },
  timer: {
    fontSize: 11,
    fontFamily: fonts.medium,
    opacity: 0.8,
    marginTop: 2,
  },
  cornerIcon: {
    position: 'absolute',
    top: 3,
    right: 3,
  },
  countBadge: {
    position: 'absolute',
    top: -7,
    left: -7,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontSize: 11,
    fontFamily: fonts.bold,
  },
});
