import { ActivityIndicator, View } from 'react-native';

import { useCopy } from '@/i18n';
import { cn } from '@/lib/cn';
import { useColors } from '@/theme/use-colors';

import { Button } from './button';
import { Text } from './text';

/** Placeholder while data loads. */
export function LoadingState({ className }: { className?: string }) {
  const colors = useColors();
  return (
    <View className={cn('items-center justify-center py-12', className)}>
      <ActivityIndicator color={colors.cobalt} />
    </View>
  );
}

/** Shown when a request fails; offers a retry when one is possible. */
export function ErrorState({ onRetry, className }: { onRetry?: () => void; className?: string }) {
  const copy = useCopy();
  return (
    <View className={cn('items-center gap-4 py-12', className)}>
      <Text tone="muted" className="text-center">
        {copy.common.loadFailed}
      </Text>
      {onRetry ? <Button variant="secondary" label={copy.common.retry} onPress={onRetry} /> : null}
    </View>
  );
}
