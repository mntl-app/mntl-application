import { twMerge } from 'tailwind-merge';

/**
 * Joins class names, skipping falsy values, and resolves Tailwind conflicts so a caller's
 * `className` wins over a component's defaults (Uniwind itself does not deduplicate classes).
 */
export const cn = twMerge;
