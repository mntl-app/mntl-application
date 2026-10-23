import type { Level } from '@/api/types';

/** Topic levels from least to most. */
export const LEVELS: readonly Level[] = ['less', 'balanced', 'more'];

/** The neighbouring level in the given direction, clamped at either end. */
export function stepLevel(level: Level, by: 1 | -1): Level {
  const index = Math.min(LEVELS.length - 1, Math.max(0, LEVELS.indexOf(level) + by));
  return LEVELS[index];
}
