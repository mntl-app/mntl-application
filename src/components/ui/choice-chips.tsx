import { View } from 'react-native';

import { cn } from '@/lib/cn';

import { Chip } from './chip';

export type Option<T extends string> = { value: T; label: string };

type CommonProps<T extends string> = {
  options: readonly Option<T>[];
  /** Describes the group for screen readers, e.g. "Feed order". */
  accessibilityLabel?: string;
  className?: string;
};

type SingleProps<T extends string> = CommonProps<T> & {
  multiple?: false;
  value: T;
  onChange: (value: T) => void;
};

type MultipleProps<T extends string> = CommonProps<T> & {
  multiple: true;
  value: readonly T[];
  onChange: (value: T[]) => void;
};

/** A wrapping row of chips: pick one (`radio`) or, with `multiple`, any number (`checkbox`). */
export function ChoiceChips<T extends string>(props: SingleProps<T> | MultipleProps<T>) {
  const isSelected = (value: T) =>
    props.multiple ? props.value.includes(value) : props.value === value;

  const select = (value: T) => {
    if (!props.multiple) return props.onChange(value);
    props.onChange(
      props.value.includes(value)
        ? props.value.filter((v) => v !== value)
        : [...props.value, value],
    );
  };

  return (
    <View
      role={props.multiple ? 'group' : 'radiogroup'}
      aria-label={props.accessibilityLabel}
      className={cn('flex-row flex-wrap gap-2', props.className)}>
      {props.options.map((option) => {
        const selected = isSelected(option.value);
        return (
          <Chip
            key={option.value}
            label={option.label}
            selected={selected}
            onPress={() => select(option.value)}
            role={props.multiple ? 'checkbox' : 'radio'}
            aria-checked={selected}
            aria-selected={undefined}
          />
        );
      })}
    </View>
  );
}

/** Builds options from a value → label map, keeping its order. */
export function toOptions<T extends string>(labels: Record<T, string>): Option<T>[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}
