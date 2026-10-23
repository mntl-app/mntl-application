import { useCSSVariable } from 'uniwind';

/**
 * Design tokens as plain colour strings, for the few APIs that take a colour prop instead of a
 * className (navigation theme, sheet background, spinners, pull-to-refresh).
 */
export function useColors() {
  return {
    canvas: String(useCSSVariable('--color-canvas')),
    card: String(useCSSVariable('--color-card')),
    line: String(useCSSVariable('--color-line')),
    ink: String(useCSSVariable('--color-ink')),
    cobalt: String(useCSSVariable('--color-cobalt')),
  };
}
