import {
  ChoiceChips,
  ErrorState,
  LoadingState,
  PageHeading,
  Screen,
  Section,
  SettingRow,
  SliderRow,
  Text,
  toOptions,
} from '@/components/ui';
import { useCopy } from '@/i18n';

import { useAlgorithmPreferences, useSetTopicLevel, useUpdateAlgorithmPreferences } from './api';

export function AlgorithmScreen() {
  const copy = useCopy();
  const preferences = useAlgorithmPreferences();
  const update = useUpdateAlgorithmPreferences();
  const setTopicLevel = useSetTopicLevel();

  return (
    <Screen scroll className="gap-[14px]">
      <PageHeading title={copy.algorithm.title} intro={copy.algorithm.intro} />

      {preferences.isPending ? (
        <LoadingState />
      ) : preferences.isError ? (
        <ErrorState onRetry={() => preferences.refetch()} />
      ) : (
        <>
          <Section title={copy.algorithm.feedOrder}>
            <ChoiceChips
              options={toOptions(copy.algorithm.orders)}
              value={preferences.data.order}
              onChange={(order) => update.mutate({ order })}
              accessibilityLabel={copy.algorithm.feedOrder}
            />
          </Section>

          <Section title={copy.algorithm.topics}>
            {preferences.data.topics.length > 0 ? (
              preferences.data.topics.map(({ topic, level }) => (
                <SliderRow
                  key={topic.id}
                  label={topic.name}
                  value={level}
                  onChange={(next) => setTopicLevel(topic, next)}
                />
              ))
            ) : (
              <Text tone="muted">{copy.algorithm.noTopics}</Text>
            )}
          </Section>

          <Section title={copy.algorithm.contentTypes}>
            <ChoiceChips
              multiple
              options={toOptions(copy.algorithm.types)}
              value={preferences.data.contentTypes}
              onChange={(contentTypes) => update.mutate({ contentTypes })}
              accessibilityLabel={copy.algorithm.contentTypes}
            />
          </Section>

          <SettingRow
            title={copy.algorithm.strangers.title}
            description={copy.algorithm.strangers.description}
            value={preferences.data.showStrangers}
            onValueChange={(showStrangers) => update.mutate({ showStrangers })}
          />
        </>
      )}
    </Screen>
  );
}
