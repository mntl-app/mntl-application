import { View } from 'react-native';

import { ErrorState, LoadingState, PageHeading, Screen, SettingRow } from '@/components/ui';
import { useCopy } from '@/i18n';

import { useUpdateWellbeingSettings, useUsageToday, useWellbeingSettings } from './api';
import { TodayUsageCard } from './components/today-usage-card';

export function WellbeingScreen() {
  const copy = useCopy();
  const settings = useWellbeingSettings();
  const usage = useUsageToday();
  const update = useUpdateWellbeingSettings();

  const isPending = settings.isPending || usage.isPending;
  const isError = settings.isError || usage.isError;

  return (
    <Screen scroll className="gap-5">
      <PageHeading title={copy.wellbeing.title} intro={copy.wellbeing.intro} />

      {isPending ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState
          onRetry={() => {
            settings.refetch();
            usage.refetch();
          }}
        />
      ) : (
        <>
          <TodayUsageCard
            minutesUsed={usage.data.minutesUsed}
            limitMinutes={settings.data.dailyLimit.enabled ? settings.data.dailyLimit.minutes : null}
          />

          <View className="gap-2">
            <SettingRow
              title={copy.wellbeing.dailyLimit.title}
              description={copy.wellbeing.dailyLimit.description(settings.data.dailyLimit.minutes)}
              value={settings.data.dailyLimit.enabled}
              onValueChange={(enabled) =>
                update.mutate({ dailyLimit: { ...settings.data.dailyLimit, enabled } })
              }
            />
            <SettingRow
              title={copy.wellbeing.endOfFeed.title}
              description={copy.wellbeing.endOfFeed.description}
              value={settings.data.endOfFeed}
              onValueChange={(endOfFeed) => update.mutate({ endOfFeed })}
            />
            <SettingRow
              title={copy.wellbeing.quietHours.title}
              description={copy.wellbeing.quietHours.description(
                settings.data.quietHours.start,
                settings.data.quietHours.end,
              )}
              value={settings.data.quietHours.enabled}
              onValueChange={(enabled) =>
                update.mutate({ quietHours: { ...settings.data.quietHours, enabled } })
              }
            />
            <SettingRow
              title={copy.wellbeing.hideLikeCounts.title}
              description={copy.wellbeing.hideLikeCounts.description}
              value={settings.data.hideLikeCounts}
              onValueChange={(hideLikeCounts) => update.mutate({ hideLikeCounts })}
            />
          </View>
        </>
      )}
    </Screen>
  );
}
