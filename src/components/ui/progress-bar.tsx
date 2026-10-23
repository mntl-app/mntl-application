import { View } from 'react-native';

import { cn } from '@/lib/cn';

type ProgressBarProps = {
  /** 0 to 1; values outside the range are clamped. */
  progress: number;
  /** Track styling, e.g. its colour. */
  className?: string;
  fillClassName?: string;
};

export function ProgressBar({ progress, className, fillClassName }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <View
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn('h-2 overflow-hidden rounded-[4px] bg-line', className)}>
      <View
        className={cn('h-full rounded-[4px] bg-cobalt', fillClassName)}
        style={{ width: `${clamped * 100}%` }}
      />
    </View>
  );
}
