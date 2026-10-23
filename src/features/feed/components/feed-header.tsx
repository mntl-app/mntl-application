import { router } from 'expo-router';
import { View } from 'react-native';

import { Pill, Text } from '@/components/ui';
import { useUsageToday, useWellbeingSettings } from '@/features/wellbeing/api';
import { useCopy } from '@/i18n';

/** Wordmark plus today's time against the daily limit, which links to the wellbeing tab. */
export function FeedHeader() {
  const copy = useCopy();
  const usage = useUsageToday();
  const settings = useWellbeingSettings();

  const limit = settings.data?.dailyLimit.enabled ? settings.data.dailyLimit.minutes : null;

  return (
    <View className="min-h-8 flex-row items-center justify-between px-1">
      <Text variant="wordmark" accessibilityRole="header">
        {copy.brand.name}
      </Text>
      {usage.data && settings.data ? (
        <Pill
          icon="leaf-cobalt"
          label={copy.feed.timeToday(usage.data.minutesUsed, limit)}
          accessibilityHint={copy.feed.timeTodayHint}
          onPress={() => router.navigate('/wellbeing')}
          className="gap-1.5 py-[7px] pr-3 pl-2.5"
        />
      ) : null}
    </View>
  );
}
