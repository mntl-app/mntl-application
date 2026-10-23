import { type Copy, en } from './en';

/**
 * Returns the copy for the current locale. English only for now; adding a locale means adding a
 * `Copy` object and picking it here (e.g. from `expo-localization` or a user setting).
 */
export function useCopy(): Copy {
  return en;
}

export type { Copy };
