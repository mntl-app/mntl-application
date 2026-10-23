import type { FeedMode, ID } from './types';

/** Every TanStack Query cache key in one place, so invalidation stays consistent. */
export const queryKeys = {
  session: ['session'] as const,
  topics: ['topics'] as const,
  feeds: ['feed'] as const,
  feed: (mode: FeedMode) => ['feed', mode] as const,
  userPosts: (userId: ID) => ['users', userId, 'posts'] as const,
  postExplanation: (postId: ID) => ['posts', postId, 'explanation'] as const,
  algorithmPreferences: ['algorithm-preferences'] as const,
  wellbeingSettings: ['wellbeing', 'settings'] as const,
  usageToday: ['wellbeing', 'usage-today'] as const,
};
