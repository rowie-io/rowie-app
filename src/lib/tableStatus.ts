/**
 * Table status color tokens — MUST match `rowie-vendor/lib/table-status.ts`.
 *
 * The five-state model comes from industry convergence across Toast, Square,
 * Lightspeed, and Clover. Colors are derived from the amber/stone brand
 * palette so they fit the existing theme.
 *
 * Thresholds are in MINUTES of elapsed time since the session's LAST ACTIVITY
 * (see `deriveTableStatus` below). Keep these thresholds in sync with the
 * vendor portal so a table looks identical whether a server views it on their
 * phone or on a monitor.
 */

export type TableStatus =
  | 'empty'
  | 'active'
  | 'aging'
  | 'urgent'
  | 'check_requested'
  | 'merged'
  | 'unavailable';

export const TABLE_STATUS_COLORS: Record<
  TableStatus,
  {
    fill: string;
    border: string;
    text: string;
    label: string;
    /**
     * Redundant non-color cue (Ionicons glyph) rendered in the tile corner and
     * next to the legend label, so states remain distinguishable in grayscale
     * and for colorblind users. `null` states are distinguishable without a
     * glyph: 'empty' has no timer, 'active' shows the timer without a glyph.
     */
    icon: string | null;
  }
> = {
  empty: {
    fill: '#292524', // stone-800
    border: '#44403C', // stone-700
    text: '#A8A29E', // stone-400
    label: 'Available',
    icon: null,
  },
  active: {
    fill: 'rgba(34, 197, 94, 0.1)', // green-500 @ 10%
    border: '#22C55E',
    text: '#F5F5F4',
    label: 'Seated',
    icon: null,
  },
  aging: {
    fill: 'rgba(245, 158, 11, 0.12)', // amber-500 @ 12%
    border: '#F59E0B',
    text: '#F5F5F4',
    label: 'Aging',
    icon: 'hourglass-outline',
  },
  urgent: {
    fill: 'rgba(239, 68, 68, 0.12)', // red-500 @ 12%
    border: '#EF4444',
    text: '#F5F5F4',
    label: 'Urgent',
    icon: 'alert-circle',
  },
  check_requested: {
    fill: '#F59E0B',
    border: '#F59E0B',
    text: '#1C1917',
    label: 'Check requested',
    icon: 'receipt-outline',
  },
  merged: {
    fill: 'rgba(168, 85, 247, 0.06)', // purple-500 @ 6% — very subtle
    border: 'rgba(168, 85, 247, 0.3)',
    text: '#57534E',
    label: 'Merged',
    icon: 'git-merge-outline',
  },
  unavailable: {
    fill: '#1C1917', // stone-900
    border: '#292524',
    text: '#57534E',
    label: 'Unavailable',
    icon: 'close-circle-outline',
  },
};

/** Minutes. Keep identical across repos. */
export const TABLE_STATUS_THRESHOLDS = {
  /** Transition from 'active' → 'aging' */
  agingAt: 30,
  /** Transition from 'aging' → 'urgent' */
  urgentAt: 60,
};

function toMs(value: string | Date): number {
  return typeof value === 'string' ? new Date(value).getTime() : value.getTime();
}

/**
 * Derive the visual status of a table from its live session state.
 *
 * `tableStatus` is the table row's own column (`available | occupied |
 * reserved | cleaning | merged | unavailable`). It overrides the session-
 * derived state for the non-session states ('merged', 'unavailable') so a
 * merged secondary or out-of-service table renders correctly even when an
 * adjacent session is open.
 *
 * Aging is based on time since LAST ACTIVITY, not time since the session was
 * opened. `table_sessions.updated_at` is bumped by a DB trigger on every row
 * update (item adds recalc totals, status changes, check requests), so a
 * normal 90-minute dinner where rounds keep landing stays 'active' instead of
 * pinning permanently red. Callers pass the freshest timestamp they have via
 * `lastActivityAt` (usually the session's `updatedAt`); when absent we fall
 * back to `openedAt`.
 */
export function deriveTableStatus(
  session:
    | {
        openedAt: string | Date;
        /** Freshest activity timestamp — e.g. the session's `updatedAt`. */
        lastActivityAt?: string | Date | null;
        checkRequested?: boolean;
      }
    | null
    | undefined,
  now: number = Date.now(),
  tableStatus?: string,
): TableStatus {
  if (tableStatus === 'merged') return 'merged';
  if (tableStatus === 'unavailable') return 'unavailable';
  if (!session) return 'empty';
  if (session.checkRequested) return 'check_requested';

  const opened = toMs(session.openedAt);
  const lastActivity = session.lastActivityAt ? toMs(session.lastActivityAt) : opened;
  // Guard against clock skew / bad data: never age from a point before open.
  const reference = Math.max(opened, lastActivity);
  const elapsedMinutes = (now - reference) / 60000;

  if (elapsedMinutes >= TABLE_STATUS_THRESHOLDS.urgentAt) return 'urgent';
  if (elapsedMinutes >= TABLE_STATUS_THRESHOLDS.agingAt) return 'aging';
  return 'active';
}

/**
 * Format elapsed minutes as `H:MM` / `M:SS` for the table tile timer.
 */
export function formatElapsed(openedAt: string | Date, now: number = Date.now()): string {
  const opened =
    typeof openedAt === 'string' ? new Date(openedAt).getTime() : openedAt.getTime();
  const totalSeconds = Math.max(0, Math.floor((now - opened) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}h`;
  }
  return `${minutes}m`;
}
