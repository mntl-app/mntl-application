import type {
  AlgorithmPreferences,
  FeedMode,
  ID,
  Page,
  Post,
  PostExplanation,
  Session,
  Topic,
  UsageToday,
  WellbeingSettings,
} from './types';

/**
 * Everything the app needs from the backend. Screens never call this directly: they go through
 * the TanStack Query hooks in each feature, so swapping the mock for a real HTTP client only
 * means providing another implementation of this interface in src/api/index.ts.
 */
export interface ApiClient {
  getSession(): Promise<Session>;
  completeOnboarding(input: { topicIds: ID[] }): Promise<Session>;

  getTopics(): Promise<Topic[]>;

  getFeed(params: { mode: FeedMode; cursor?: string | null }): Promise<Page<Post>>;
  getUserPosts(params: { userId: ID; cursor?: string | null }): Promise<Page<Post>>;
  getPostExplanation(postId: ID): Promise<PostExplanation>;

  getAlgorithmPreferences(): Promise<AlgorithmPreferences>;
  updateAlgorithmPreferences(patch: Partial<AlgorithmPreferences>): Promise<AlgorithmPreferences>;

  getWellbeingSettings(): Promise<WellbeingSettings>;
  updateWellbeingSettings(patch: Partial<WellbeingSettings>): Promise<WellbeingSettings>;
  getUsageToday(): Promise<UsageToday>;
}
