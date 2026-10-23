import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api';
import { queryKeys } from '@/api/query-keys';

export function useTopics() {
  return useQuery({ queryKey: queryKeys.topics, queryFn: () => api.getTopics() });
}

/**
 * Saves the picked topics and marks onboarding as done. Writing the new session into the cache
 * flips the guard in the root layout, which moves the user on to the feed.
 */
export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (topicIds: string[]) => api.completeOnboarding({ topicIds }),
    onSuccess: (session) => {
      queryClient.setQueryData(queryKeys.session, session);
      queryClient.invalidateQueries({ queryKey: queryKeys.algorithmPreferences });
      queryClient.invalidateQueries({ queryKey: queryKeys.feeds });
    },
  });
}
