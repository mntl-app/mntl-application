import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { ID } from '@/api';
import { Button, ErrorState, Grabber, LoadingState, SliderRow, Text } from '@/components/ui';
import { levelForTopic, useAlgorithmPreferences, useSetTopicLevel } from '@/features/algorithm/api';
import { useCopy } from '@/i18n';
import { stepLevel } from '@/lib/levels';

import { usePostExplanation } from './api';
import { ExplanationReasons } from './components/explanation-reasons';

/** Bottom sheet listing everything the algorithm used for a post, with controls to tune it. */
export function WhyThisPostScreen({ postId }: { postId: ID }) {
  const copy = useCopy();
  const explanation = usePostExplanation(postId);
  const preferences = useAlgorithmPreferences();
  const setTopicLevel = useSetTopicLevel();

  if (explanation.isPending) {
    return (
      <Sheet>
        <LoadingState />
      </Sheet>
    );
  }
  if (explanation.isError) {
    return (
      <Sheet>
        <ErrorState onRetry={() => explanation.refetch()} />
      </Sheet>
    );
  }

  const { reasons, topic } = explanation.data;
  const level = levelForTopic(preferences.data, topic.id);

  const showLess = () => {
    setTopicLevel(topic, stepLevel(level, -1));
    router.back();
  };

  return (
    <Sheet>
      <View className="gap-1.5">
        <Text variant="title" accessibilityRole="header">
          {copy.why.title}
        </Text>
        <Text variant="small" tone="muted">
          {copy.why.subtitle}
        </Text>
      </View>
      <ExplanationReasons reasons={reasons} />
      <Text variant="small" tone="muted">
        {copy.why.notUsed}
      </Text>
      <SliderRow label={topic.name} value={level} onChange={(next) => setTopicLevel(topic, next)} />
      <View className="flex-row items-center gap-2.5">
        <Button variant="secondary" label={copy.why.showLess} onPress={showLess} className="flex-1 px-4" />
        <Button label={copy.why.done} onPress={() => router.back()} className="flex-1 px-4" />
      </View>
    </Sheet>
  );
}

function Sheet({ children }: { children: ReactNode }) {
  return (
    <View className="gap-4 bg-card px-6 pt-3 pb-9">
      <Grabber />
      {children}
    </View>
  );
}
