import { View, type ViewProps } from 'react-native';

import { cn } from '@/lib/cn';

/** Raised surface used by rows and posts: card background, hairline border, 18px corners. */
export function Card({ className, ...props }: ViewProps) {
  return <View className={cn('rounded-[18px] border border-line bg-card', className)} {...props} />;
}
