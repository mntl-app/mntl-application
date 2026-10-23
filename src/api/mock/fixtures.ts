import type {
  AlgorithmPreferences,
  Post,
  Topic,
  UsageToday,
  User,
  UserSummary,
  WellbeingSettings,
} from '../types';

const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

const topic = (slug: string, name: string): Topic => ({ id: `topic-${slug}`, slug, name });

/** The curated topics offered during onboarding, in display order. */
export const topics: Topic[] = [
  topic('nature', 'Nature'),
  topic('friends', 'Friends'),
  topic('design', 'Design'),
  topic('cooking', 'Cooking'),
  topic('science', 'Science'),
  topic('football', 'Football'),
  topic('music', 'Music'),
  topic('travel', 'Travel'),
  topic('news', 'News'),
  topic('mental-health', 'Mental health'),
  topic('gaming', 'Gaming'),
  topic('books', 'Books'),
];

const topicBySlug = (slug: string) => topics.find((t) => t.slug === slug) ?? topic(slug, slug);
/** Free-form tag that isn't one of the curated onboarding topics. */
const trains = topic('trains', 'Trains');

export const me: User = {
  id: 'user-sen',
  handle: 'sen',
  displayName: 'Sen',
  avatarUrl: null,
  bio: 'Building a calmer internet. Photos of trains, plants and the odd sunset.',
  location: 'Gent',
  stats: { posts: 42, following: 180, followers: null },
};

const lina: UserSummary = { id: 'user-lina', handle: 'linawalks', displayName: 'Lina Verbeke', avatarUrl: null };
const jonas: UserSummary = { id: 'user-jonas', handle: 'jonasds', displayName: 'Jonas De Smet', avatarUrl: null };
const noor: UserSummary = { id: 'user-noor', handle: 'noorbakes', displayName: 'Noor El Amrani', avatarUrl: null };
const eszter: UserSummary = { id: 'user-eszter', handle: 'eszterdraws', displayName: 'Eszter Nagy', avatarUrl: null };

/** Accounts the signed-in user follows. Everyone else counts as a stranger. */
export const followingIds = new Set([lina.id, jonas.id, noor.id]);

const photo = (seed: string, alt: string) => ({
  id: `media-${seed}`,
  kind: 'image' as const,
  url: `https://picsum.photos/seed/mntl-${seed}/1200/760`,
  width: 1200,
  height: 760,
  alt,
});

export const posts: Post[] = [
  {
    id: 'post-1',
    author: lina,
    body: 'Took the long way home through the Zoniënwoud today. No phone for an hour, just this light.',
    media: [photo('zonienwoud', 'Late afternoon light between beech trees')],
    topic: topicBySlug('nature'),
    createdAt: hoursAgo(2),
    likeCount: 128,
    commentCount: 14,
  },
  {
    id: 'post-2',
    author: jonas,
    body: 'Finally finished the bookshelf. Three weekends, one wobbly leg, zero regrets.',
    media: [],
    topic: topicBySlug('friends'),
    createdAt: hoursAgo(5),
    likeCount: 128,
    commentCount: 14,
  },
  {
    id: 'post-3',
    author: noor,
    body: 'Sourdough attempt number four. It finally rose. Recipe for anyone who asks.',
    media: [photo('sourdough', 'A round sourdough loaf on a wooden board')],
    topic: topicBySlug('cooking'),
    createdAt: hoursAgo(8),
    likeCount: 64,
    commentCount: 9,
  },
  {
    id: 'post-4',
    author: eszter,
    body: 'Redrew our café menu by hand this morning. Turns out the best tool was a pencil.',
    media: [],
    topic: topicBySlug('design'),
    createdAt: hoursAgo(11),
    likeCount: 41,
    commentCount: 3,
  },
  {
    id: 'post-5',
    author: lina,
    body: 'Night train to Vienna booked. Eleven hours of reading and no Wi-Fi.',
    media: [],
    topic: topicBySlug('travel'),
    createdAt: hoursAgo(27),
    likeCount: 87,
    commentCount: 12,
  },
  {
    id: 'post-6',
    author: jonas,
    body: 'Took my niece to the planetarium. She wants to be an astronaut now. I want a bigger telescope.',
    media: [],
    topic: topicBySlug('science'),
    createdAt: hoursAgo(50),
    likeCount: 52,
    commentCount: 6,
  },
  {
    id: 'post-me-1',
    author: { id: me.id, handle: me.handle, displayName: me.displayName, avatarUrl: me.avatarUrl },
    body: 'Turned off every recommendation for a week. Turns out my feed is mostly trains. No complaints.',
    media: [photo('trains', 'A regional train crossing a bridge at dusk')],
    topic: trains,
    createdAt: hoursAgo(30),
    likeCount: 128,
    commentCount: 14,
  },
];

export const algorithmPreferences: AlgorithmPreferences = {
  order: 'your-rules',
  topics: [
    { topic: topicBySlug('nature'), level: 'more' },
    { topic: topicBySlug('friends'), level: 'more' },
    { topic: topicBySlug('news'), level: 'less' },
  ],
  contentTypes: ['photos', 'long-reads'],
  showStrangers: false,
};

export const wellbeingSettings: WellbeingSettings = {
  dailyLimit: { enabled: true, minutes: 45 },
  endOfFeed: true,
  quietHours: { enabled: true, start: '22:00', end: '07:00' },
  hideLikeCounts: false,
};

export const usageToday: UsageToday = {
  date: new Date().toISOString().slice(0, 10),
  minutesUsed: 24,
};
