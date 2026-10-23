import { View } from 'react-native';

import { cn } from '@/lib/cn';

import { Card } from './card';
import { Text } from './text';
import { Toggle } from './toggle';

type SettingRowProps = {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
};

export function SettingRow({ title, description, value, onValueChange, disabled, className }: SettingRowProps) {
  return (
    <Card className={cn('flex-row items-center gap-4 px-[18px] py-4', className)}>
      <View className="flex-1 gap-0.5">
        <Text>{title}</Text>
        <Text variant="small">{description}</Text>
      </View>
      <Toggle
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={title}
        accessibilityHint={description}
      />
    </Card>
  );
}
