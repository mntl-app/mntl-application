import { useState } from 'react';
import { type GestureResponderEvent, View } from 'react-native';
import Animated from 'react-native-reanimated';

import type { Level } from '@/api/types';
import { cn } from '@/lib/cn';
import { LEVELS, stepLevel } from '@/lib/levels';

/** Where each level sits along the track, from the Figma tracks (61, 153 and 251 of 306px). */
const POSITION: Record<Level, number> = { less: 0.2, balanced: 0.5, more: 0.82 };
const KNOB_SIZE = 18;
const transition = { transitionDuration: 150 } as const;

type LevelSliderProps = {
  value: Level;
  onChange: (level: Level) => void;
  /** What is being adjusted, e.g. the topic name. */
  accessibilityLabel: string;
  /** The current level as read out, e.g. "More". */
  valueLabel: string;
  className?: string;
};

/** Three-step slider: tap or drag to the nearest level. Screen readers adjust it by swiping. */
export function LevelSlider({ value, onChange, accessibilityLabel, valueLabel, className }: LevelSliderProps) {
  const [width, setWidth] = useState(0);

  const pickAt = (event: GestureResponderEvent) => {
    if (!width) return;
    const ratio = event.nativeEvent.locationX / width;
    const nearest = LEVELS.reduce((best, level) =>
      Math.abs(POSITION[level] - ratio) < Math.abs(POSITION[best] - ratio) ? level : best,
    );
    if (nearest !== value) onChange(nearest);
  };

  const position = `${POSITION[value] * 100}%` as const;

  return (
    <View
      accessible
      role="slider"
      aria-label={accessibilityLabel}
      aria-valuemin={0}
      aria-valuemax={LEVELS.length - 1}
      aria-valuenow={LEVELS.indexOf(value)}
      aria-valuetext={valueLabel}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) =>
        onChange(stepLevel(value, event.nativeEvent.actionName === 'increment' ? 1 : -1))
      }
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={pickAt}
      onResponderMove={pickAt}
      hitSlop={{ top: 12, bottom: 12 }}
      className={cn('h-[18px] justify-center', className)}>
      <View pointerEvents="none" className="h-[6px] overflow-hidden rounded-[3px] bg-line">
        <Animated.View style={{ width: position, height: '100%', transitionProperty: 'width', ...transition }}>
          <View className="flex-1 rounded-[3px] bg-cobalt" />
        </Animated.View>
      </View>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: position,
          marginLeft: -KNOB_SIZE / 2,
          transitionProperty: 'left',
          ...transition,
        }}>
        <View className="size-[18px] rounded-full bg-card" />
      </Animated.View>
    </View>
  );
}
