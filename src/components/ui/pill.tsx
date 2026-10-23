import { Pressable, type PressableProps } from 'react-native';

import { cn } from '@/lib/cn';

import { Icon, type IconName } from './icon';
import { Text } from './text';

export type PillProps = Omit<PressableProps, 'children'> & {
  icon: IconName;
  label: string;
};

/** Soft cobalt capsule with an icon and a short label ("Why this?", "24 of 45 min"). */
export function Pill({ icon, label, onPress, className, ...props }: PillProps) {
  return (
    <Pressable
      role={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      hitSlop={6}
      className={cn('flex-row items-center rounded-full bg-cobalt-soft active:opacity-80', className)}
      {...props}>
      <Icon name={icon} />
      <Text variant="small" tone="cobalt">
        {label}
      </Text>
    </Pressable>
  );
}
