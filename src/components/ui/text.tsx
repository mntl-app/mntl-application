import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { cn } from '@/lib/cn';

/**
 * The type scale from the Figma text styles. Line heights are in pixels (font size × the Figma
 * ratio) because React Native has no unitless line height.
 */
const variants = {
  /** Oversized wordmark on the onboarding hero. */
  hero: 'font-display text-[112px] leading-[99px] tracking-[-2.24px] uppercase',
  /** Display/L: screen titles and big numbers. */
  display: 'font-display text-[34px] leading-[31px] tracking-[-0.34px] uppercase',
  /** Title: sheet titles and profile stats. */
  title: 'font-display text-[20px] leading-[22px] uppercase',
  /** Wordmark in the app header. */
  wordmark: 'font-wordmark text-[24px] leading-[24px] tracking-[-0.48px] uppercase',
  /** Body: the default for running text and labels. */
  body: 'font-body text-[15px] leading-[21px]',
  /** Body/Small: secondary text, chips, captions. */
  small: 'font-body text-[13px] leading-[17.5px]',
  /** Overline: uppercase section labels. */
  overline: 'font-body text-[11px] leading-[13px] tracking-[0.88px] uppercase',
} as const;

const tones = {
  ink: 'text-ink',
  muted: 'text-muted',
  cobalt: 'text-cobalt',
  'on-dark': 'text-on-dark',
} as const;

export type TextVariant = keyof typeof variants;
export type TextTone = keyof typeof tones;

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  tone?: TextTone;
};

/** All text in the app. Pick a `variant` and `tone`; use `className` for layout only. */
export function Text({ variant = 'body', tone = 'ink', className, ...props }: TextProps) {
  return <RNText className={cn(variants[variant], tones[tone], className)} {...props} />;
}
