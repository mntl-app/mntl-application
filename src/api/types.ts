/**
 * Domain models shared by the UI and the data layer. They describe what the backend is expected
 * to return, so the mock client and a future HTTP client both implement against them.
 */

export type ID = string;
/** ISO 8601 timestamp, e.g. "2026-10-23T14:05:00.000Z". */
export type ISODateString = string;
/** 24-hour clock time, e.g. "22:00". */
export type ClockTime = string;

/** A cursor-paginated slice of a list. `nextCursor` is null on the last page. */
export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type Topic = {
  id: ID;
  /** Used for the hashtag shown on posts ("#nature"). */
  slug: string;
  name: string;
};

/** How much of a topic someone wants to see. */
export type Level = 'less' | 'balanced' | 'more';

export type UserSummary = {
  id: ID;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
};

export type User = UserSummary & {
  bio: string;
  location: string | null;
  stats: {
    posts: number;
    following: number;
    /** Null when the follower count is hidden. */
    followers: number | null;
  };
};

export type MediaAsset = {
  id: ID;
  kind: 'image';
  url: string;
  width: number;
  height: number;
  alt: string;
};

export type Post = {
  id: ID;
  author: UserSummary;
  body: string;
  media: MediaAsset[];
  topic: Topic;
  createdAt: ISODateString;
  likeCount: number;
  commentCount: number;
};

/** The source filter at the top of the feed. */
export type FeedMode = 'your-rules' | 'following' | 'latest';

/** How the feed is ordered, chosen on the algorithm screen. */
export type FeedOrder = 'your-rules' | 'latest' | 'mixed';

export type ContentType = 'photos' | 'long-reads' | 'short-videos' | 'reposts';

export type TopicPreference = {
  topic: Topic;
  level: Level;
};

export type AlgorithmPreferences = {
  order: FeedOrder;
  topics: TopicPreference[];
  contentTypes: ContentType[];
  /** Whether recommended accounts the user doesn't follow can appear. */
  showStrangers: boolean;
};

/** One signal the algorithm used to rank a post. The client turns it into a sentence. */
export type ExplanationReason =
  | { kind: 'topic-level'; topic: Topic; level: Level }
  | { kind: 'follows-author'; handle: string }
  | { kind: 'recent'; withinHours: number };

export type PostExplanation = {
  postId: ID;
  /** Everything the algorithm used for this post, and nothing else. */
  reasons: ExplanationReason[];
  /** The topic the "show less like this" action and the slider in the sheet act on. */
  topic: Topic;
};

export type WellbeingSettings = {
  dailyLimit: { enabled: boolean; minutes: number };
  /** Finite feed: it ends once the user is caught up instead of scrolling forever. */
  endOfFeed: boolean;
  quietHours: { enabled: boolean; start: ClockTime; end: ClockTime };
  hideLikeCounts: boolean;
};

export type UsageToday = {
  /** Calendar day in the user's time zone, e.g. "2026-10-23". */
  date: string;
  minutesUsed: number;
};

export type Session = {
  user: User;
  onboardingCompleted: boolean;
};
