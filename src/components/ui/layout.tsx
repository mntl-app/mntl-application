import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { cn } from '@/lib/cn';

import { Text } from './text';

type ScreenProps = {
  children: ReactNode;
  /** Wrap the content in a vertical ScrollView. */
  scroll?: boolean;
  /** Pad for the bottom safe area too; screens inside the tab bar leave that to the tab bar. */
  safeBottom?: boolean;
  /** Content container classes; defaults to the design's 24px gutters. */
  className?: string;
};

/** Page frame: canvas background, top safe area, and the standard content padding. */
export function Screen({ children, scroll = false, safeBottom = false, className }: ScreenProps) {
  const content = cn('px-6 pt-2 pb-4', className);
  return (
    <View className={cn('flex-1 bg-canvas pt-safe', safeBottom && 'pb-safe')}>
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={content}
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View className={cn('flex-1', content)}>{children}</View>
      )}
    </View>
  );
}

/** Screen title in the display face with a short muted intro underneath. */
export function PageHeading({ title, intro }: { title: string; intro: string }) {
  return (
    <View className="gap-1.5">
      <Text variant="display" accessibilityRole="header">
        {title}
      </Text>
      <Text tone="muted">{intro}</Text>
    </View>
  );
}

/** A group of controls under an uppercase overline label. */
export function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <View className={cn('gap-2', className)}>
      <Text variant="overline" tone="muted" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Drag handle at the top of a bottom sheet. */
export function Grabber() {
  return <View className="h-[5px] w-10 self-center rounded-[3px] bg-line" />;
}
