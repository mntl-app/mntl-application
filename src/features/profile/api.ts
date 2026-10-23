import { useInfiniteQuery } from '@tanstack/react-query';

import { api, type ID } from '@/api';
import { queryKeys } from '@/api/query-keys';

export function useUserPosts(userId: ID) {
  return useInfiniteQuery({
    queryKey: queryKeys.userPosts(userId),
    queryFn: ({ pageParam }) => api.getUserPosts({ userId, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}
