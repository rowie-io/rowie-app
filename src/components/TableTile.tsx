import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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

/**
 * Runtime table tile rendered on the floor plan canvas.
 *
 * Toast-five layout: label centered, elapsed-time below when occupied,
 * seats around the perimeter. Status comes from `deriveTableStatus` so the
 * mobile view stays visually identical to the vendor portal's service view.
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
}

export const TableTile = React.memo(function TableTile({
  table,
  session,
  onPress,
  onLongPress,
  now,
  effectiveCapacity,
  mergeTargetMode,
}: TableTileProps) {
  const status: TableStatus = deriveTableStatus(
    session
      ? {
          openedAt: session.openedAt,
          checkRequested: (session as unknown as { checkRequested?: boolean }).checkRequested,
        }
      : null,
    now,
    table.status,
  );
  const palette = TABLE_STATUS_COLORS[status];
  const hasSession = !!session;
  const isDisabled = !mergeTargetMode && (status === 'merged' || status === 'unavailable');

  const shape =
    table.shape === 'circle' || table.shape === 'square' || table.shape === 'rectangle'
      ? (table.shape as 'circle' | 'square' | 'rectangle')
      : 'rectangle';

  const tableW = Math.max(40, table.width || 80);
  const tableH = Math.max(40, table.height || 80);

  const borderRadius =
    shape === 'circle' ? Math.min(tableW, tableH) / 2 : shape === 'square' ? 8 : 12;

  return (
    <View
      style={{
        position: 'absolute',
        left: (table.x || 0) - SEAT_WRAPPER_PAD,
        top: (table.y || 0) - SEAT_WRAPPER_PAD,
        width: tableW + SEAT_WRAPPER_PAD * 2,
        height: tableH + SEAT_WRAPPER_PAD * 2,
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
            ? `Merge into ${table.label}`
            : hasSession
            ? `${table.label}, ${palette.label}, ${session?.itemCount ?? 0} items`
            : `${table.label}, ${palette.label}`
        }
        style={{
          position: 'absolute',
          left: SEAT_WRAPPER_PAD,
          top: SEAT_WRAPPER_PAD,
          width: tableW,
          height: tableH,
          backgroundColor: mergeTargetMode ? 'rgba(168, 85, 247, 0.12)' : palette.fill,
          borderColor: mergeTargetMode ? '#A855F7' : palette.border,
          borderWidth: mergeTargetMode ? 3 : 2,
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
        {status === 'check_requested' && (
          <Ionicons
            name="receipt-outline"
            size={14}
            color={palette.text}
            style={styles.checkIcon}
          />
        )}
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontFamily: fonts.bold,
    textAlign: 'center',
  },
  timer: {
    fontSize: 9,
    fontFamily: fonts.medium,
    opacity: 0.75,
    marginTop: 2,
  },
  checkIcon: {
    position: 'absolute',
    top: 2,
    right: 2,
  },
});
