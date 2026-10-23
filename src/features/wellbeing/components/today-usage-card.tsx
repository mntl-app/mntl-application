import { View } from 'react-native';

import { ProgressBar, Text } from '@/components/ui';
import { useCopy } from '@/i18n';

type TodayUsageCardProps = {
  minutesUsed: number;
  /** Null when no daily limit is set; the progress bar is hidden then. */
  limitMinutes: number | null;
};

export function TodayUsageCard({ minutesUsed, limitMinutes }: TodayUsageCardProps) {
  const copy = useCopy();
  return (
    <View className="gap-2.5 rounded-[22px] bg-ink px-5 py-[18px]">
      <Text variant="overline" tone="on-dark">
        {copy.wellbeing.today}
      </Text>
      <View className="flex-row items-baseline gap-2">
        <Text variant="display" tone="on-dark">
          {copy.wellbeing.minutes(minutesUsed)}
        </Text>
        <Text tone="on-dark" className="opacity-70">
          {limitMinutes === null ? copy.wellbeing.noLimit : copy.wellbeing.ofLimit(limitMinutes)}
        </Text>
      </View>
      {limitMinutes === null ? null : (
        <ProgressBar
          progress={minutesUsed / limitMinutes}
          className="bg-on-dark"
          fillClassName="bg-cobalt-soft"
        />
      )}
    </View>
  );
}
