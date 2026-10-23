import { useQuery } from '@tanstack/react-query';

import { type AlgorithmPreferences, api, type Level, type Topic } from '@/api';
import { queryKeys } from '@/api/query-keys';
import { useOptimisticPatch } from '@/lib/use-optimistic-patch';

export function useAlgorithmPreferences() {
  return useQuery({
    queryKey: queryKeys.algorithmPreferences,
    queryFn: () => api.getAlgorithmPreferences(),
  });
}

/** Updates preferences instantly in the UI; every feed refetches once the change is saved. */
export function useUpdateAlgorithmPreferences() {
  return useOptimisticPatch<AlgorithmPreferences>({
    queryKey: queryKeys.algorithmPreferences,
    mutationFn: (patch) => api.updateAlgorithmPreferences(patch),
    invalidates: [queryKeys.feeds],
  });
}

/** The level the user picked for a topic, or "balanced" when they haven't set one. */
export function levelForTopic(preferences: AlgorithmPreferences | undefined, topicId: string): Level {
  return preferences?.topics.find((p) => p.topic.id === topicId)?.level ?? 'balanced';
}

/** Sets one topic's level, adding the topic to the preferences if it isn't there yet. */
export function useSetTopicLevel() {
  const { data } = useAlgorithmPreferences();
  const update = useUpdateAlgorithmPreferences();

  return (topic: Topic, level: Level) => {
    if (!data) return;
    const exists = data.topics.some((p) => p.topic.id === topic.id);
    const topics = exists
      ? data.topics.map((p) => (p.topic.id === topic.id ? { ...p, level } : p))
      : [...data.topics, { topic, level }];
    update.mutate({ topics });
  };
}
