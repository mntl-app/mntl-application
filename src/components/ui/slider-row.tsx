import { View } from 'react-native';

import type { Level } from '@/api/types';
import { useCopy } from '@/i18n';
import { cn } from '@/lib/cn';

import { Card } from './card';
import { LevelSlider } from './level-slider';
import { Text } from './text';

type SliderRowProps = {
  label: string;
  value: Level;
  onChange: (level: Level) => void;
  className?: string;
};

/** A labelled Less / Balanced / More slider, e.g. for one topic. */
export function SliderRow({ label, value, onChange, className }: SliderRowProps) {
  const copy = useCopy();
  const levelLabel = copy.levels[value];

  return (
    <Card className={cn('gap-[14px] px-[18px] py-4', className)}>
      <View className="flex-row items-center justify-between">
        <Text>{label}</Text>
        <Text variant="small" tone="cobalt">
          {levelLabel}
        </Text>
      </View>
      <LevelSlider value={value} onChange={onChange} accessibilityLabel={label} valueLabel={levelLabel} />
    </Card>
  );
}
