import { Pressable, type PressableProps } from 'react-native';

import { cn } from '@/lib/cn';

import { Text, type TextTone } from './text';

type ButtonVariant = 'primary' | 'secondary';

const containers: Record<ButtonVariant, string> = {
  primary: 'bg-ink',
  secondary: 'border-[1.5px] border-ink',
};

const labels: Record<ButtonVariant, TextTone> = {
  primary: 'on-dark',
  secondary: 'ink',
};

export type ButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: ButtonVariant;
};

export function Button({ label, variant = 'primary', disabled, className, ...props }: ButtonProps) {
  return (
    <Pressable
      role="button"
      aria-disabled={!!disabled}
      disabled={disabled}
      className={cn(
        'flex-row items-center justify-center rounded-full px-6 py-[15px] active:opacity-80',
        containers[variant],
        disabled && 'opacity-40',
        className,
      )}
      {...props}>
      <Text tone={labels[variant]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
