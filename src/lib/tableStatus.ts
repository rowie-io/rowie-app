/**
 * Table status color tokens — MUST match `rowie-vendor/lib/table-status.ts`.
 *
 * The five-state model comes from industry convergence across Toast, Square,
 * Lightspeed, and Clover. Colors are derived from the amber/stone brand
 * palette so they fit the existing theme.
 *
 * Thresholds are in MINUTES of elapsed time since the session was opened.
 * Keep these thresholds in sync with the vendor portal so a table looks
 * identical whether a server views it on their phone or on a monitor.
 */

export type TableStatus =
  | 'empty'
  | 'active'
  | 'aging'
  | 'urgent'
  | 'check_requested';

export const TABLE_STATUS_COLORS: Record<
  TableStatus,
  { fill: string; border: string; text: string; label: string }
> = {
  empty: {
    fill: '#292524', // stone-800
    border: '#44403C', // stone-700
    text: '#A8A29E', // stone-400
    label: 'Available',
  },
  active: {
    fill: 'rgba(34, 197, 94, 0.1)', // green-500 @ 10%
    border: '#22C55E',
    text: '#F5F5F4',
    label: 'Seated',
  },
  aging: {
    fill: 'rgba(245, 158, 11, 0.12)', // amber-500 @ 12%
    border: '#F59E0B',
    text: '#F5F5F4',
    label: 'Aging',
  },
  urgent: {
    fill: 'rgba(239, 68, 68, 0.12)', // red-500 @ 12%
    border: '#EF4444',
    text: '#F5F5F4',
    label: 'Urgent',
  },
  check_requested: {
    fill: '#F59E0B',
    border: '#F59E0B',
    text: '#1C1917',
    label: 'Check requested',
  },
};

/** Minutes. Keep identical across repos. */
export const TABLE_STATUS_THRESHOLDS = {
  /** Transition from 'active' → 'aging' */
  agingAt: 30,
  /** Transition from 'aging' → 'urgent' */
  urgentAt: 60,
};

/**
 * Derive the visual status of a table from its live session state.
 */
export function deriveTableStatus(
  session:
    | {
        openedAt: string | Date;
        checkRequested?: boolean;
      }
    | null
    | undefined,
  now: number = Date.now()
): TableStatus {
  if (!session) return 'empty';
  if (session.checkRequested) return 'check_requested';

  const opened =
    typeof session.openedAt === 'string'
      ? new Date(session.openedAt).getTime()
      : session.openedAt.getTime();
  const elapsedMinutes = (now - opened) / 60000;

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
