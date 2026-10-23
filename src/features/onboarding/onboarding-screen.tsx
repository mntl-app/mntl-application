import { useState } from 'react';
import { View } from 'react-native';

import type { ID } from '@/api';
import { Button, ChoiceChips, ErrorState, LoadingState, Screen, Section, Text } from '@/components/ui';
import { useCopy } from '@/i18n';

import { useCompleteOnboarding, useTopics } from './api';

/** Only the first step (topics) is designed so far; the copy follows the planned three steps. */
const TOTAL_STEPS = 3;

export function OnboardingScreen() {
  const copy = useCopy();
  const topics = useTopics();
  const complete = useCompleteOnboarding();
  const [selected, setSelected] = useState<ID[]>([]);

  return (
    <Screen scroll safeBottom className="grow">
      <View className="gap-[14px] pt-6">
        <Text
          variant="hero"
          tone="cobalt"
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit>
          {copy.brand.name}
        </Text>
        <Text variant="display">{copy.onboarding.headline}</Text>
        <Text tone="muted">{copy.onboarding.intro}</Text>
      </View>

      <Section title={copy.onboarding.step(1, TOTAL_STEPS)} className="mt-7 gap-3">
        {topics.isPending ? (
          <LoadingState />
        ) : topics.isError ? (
          <ErrorState onRetry={() => topics.refetch()} />
        ) : (
          <ChoiceChips
            multiple
            options={topics.data.map((topic) => ({ value: topic.id, label: topic.name }))}
            value={selected}
            onChange={setSelected}
          />
        )}
      </Section>

      <View className="min-h-7 flex-1" />

      <View className="gap-2.5">
        <Button
          label={copy.onboarding.buildFeed}
          onPress={() => complete.mutate(selected)}
          disabled={complete.isPending}
        />
        <Button
          variant="secondary"
          label={copy.onboarding.later}
          onPress={() => complete.mutate([])}
          disabled={complete.isPending}
        />
      </View>
    </Screen>
  );
}
