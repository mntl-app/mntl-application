import type { ISODateString } from '@/api/types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type RelativeTimeLabels = {
  now: string;
  yesterday: string;
};

/** Compact age of a post, as shown next to the author handle: "now", "12m", "2h", "yesterday", "3d". */
export function formatRelativeTime(
  date: ISODateString,
  labels: RelativeTimeLabels,
  now: number = Date.now(),
): string {
  const elapsed = Math.max(0, now - new Date(date).getTime());
  if (elapsed < MINUTE) return labels.now;
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 2 * DAY) return labels.yesterday;
  return `${Math.floor(elapsed / DAY)}d`;
}

/** Joins non-empty parts with the middle dot used throughout the design ("@sen · Gent"). */
export function joinWithDot(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ');
}
