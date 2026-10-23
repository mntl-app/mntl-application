import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { cn } from '@/lib/cn';

/** 46 × 28 track with a 22px knob inset by 3px, as in the Figma Toggle component. */
const KNOB_TRAVEL = 46 - 22 - 2 * 3;

export type ToggleProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  className?: string;
};

export function Toggle({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  className,
}: ToggleProps) {
  return (
    <Pressable
      role="switch"
      aria-checked={value}
      aria-disabled={!!disabled}
      aria-label={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onValueChange(!value)}
      className={cn(
        'h-[28px] w-[46px] justify-center rounded-full px-[3px]',
        value ? 'bg-cobalt' : 'bg-line',
        disabled && 'opacity-40',
        className,
      )}>
      <Animated.View
        style={{
          transform: [{ translateX: value ? KNOB_TRAVEL : 0 }],
          transitionProperty: 'transform',
          transitionDuration: 150,
        }}>
        <View className="size-[22px] rounded-full bg-card" />
      </Animated.View>
    </Pressable>
  );
}
