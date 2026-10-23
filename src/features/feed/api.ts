import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { api, type FeedMode, type ID } from '@/api';
import { queryKeys } from '@/api/query-keys';

export function useFeed(mode: FeedMode) {
  return useInfiniteQuery({
    queryKey: queryKeys.feed(mode),
    queryFn: ({ pageParam }) => api.getFeed({ mode, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function usePostExplanation(postId: ID) {
  return useQuery({
    queryKey: queryKeys.postExplanation(postId),
    queryFn: () => api.getPostExplanation(postId),
  });
}
