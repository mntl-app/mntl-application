import { Pressable, type PressableProps } from 'react-native';

import { cn } from '@/lib/cn';

import { Text } from './text';

export type ChipProps = Omit<PressableProps, 'children'> & {
  label: string;
  selected?: boolean;
};

export function Chip({ label, selected = false, className, ...props }: ChipProps) {
  return (
    <Pressable
      role="button"
      aria-selected={selected}
      className={cn(
        'rounded-full px-[14px] py-2 active:opacity-80',
        selected ? 'bg-cobalt' : 'border border-line bg-card',
        className,
      )}
      {...props}>
      <Text variant="small" tone={selected ? 'on-dark' : 'ink'}>
        {label}
      </Text>
    </Pressable>
  );
}
