import type { ContentType, FeedMode, FeedOrder, Level } from '@/api/types';

/**
 * All user-facing copy. Other locales (the website already ships EN and HU) implement the same
 * `Copy` shape, which makes a missing translation a type error.
 */
export const en = {
  brand: { name: 'MNTL' },
  common: {
    retry: 'Try again',
    loadFailed: "We couldn't load this right now.",
    now: 'now',
    yesterday: 'yesterday',
  },
  levels: { less: 'Less', balanced: 'Balanced', more: 'More' } satisfies Record<Level, string>,
  tabs: { feed: 'Feed', algorithm: 'Algorithm', wellbeing: 'Wellbeing', profile: 'Profile' },
  onboarding: {
    headline: 'Take back control of your feed.',
    intro: 'Nothing is hidden here. Pick what you want to see, and change it whenever you like.',
    step: (current: number, total: number) => `Step ${current} of ${total} · What do you want more of?`,
    buildFeed: 'Build my feed',
    later: "I'll set it up later",
  },
  feed: {
    modes: {
      'your-rules': 'Your rules',
      following: 'Following',
      latest: 'Latest first',
    } satisfies Record<FeedMode, string>,
    modesLabel: 'Feed filter',
    timeToday: (used: number, limit: number | null) =>
      limit === null ? `${used} min today` : `${used} of ${limit} min`,
    timeTodayHint: 'Opens your wellbeing settings',
    caughtUp: "You're all caught up.",
    empty: 'Nothing here yet. Follow people or add topics to fill your feed.',
  },
  post: {
    whyThis: 'Why this?',
    whyThisHint: 'Shows why this post is in your feed',
    likes: (count: number) => `${count} likes`,
    comments: (count: number) => `${count} comments`,
    media: 'Photo',
  },
  why: {
    title: "Why you're seeing this",
    subtitle: 'This is everything the algorithm used. Nothing else.',
    notUsed: 'Not used: how long you looked, trending, ads.',
    reasons: {
      topicLevel: (topic: string, level: string) => `You set ${topic} to ${level}`,
      followsAuthor: (handle: string) => `You follow @${handle}`,
      recent: (hours: number) => `Posted in the last ${hours} hours`,
    },
    showLess: 'Show less like this',
    done: 'Done',
  },
  algorithm: {
    title: 'Your algorithm',
    intro: 'You decide what shows up. Changes apply right away.',
    feedOrder: 'Feed order',
    orders: {
      'your-rules': 'Your rules',
      latest: 'Latest first',
      mixed: 'Mixed',
    } satisfies Record<FeedOrder, string>,
    topics: 'Topics',
    noTopics: 'No topics yet. Pick some during onboarding or follow people you like.',
    contentTypes: 'Content types',
    types: {
      photos: 'Photos',
      'long-reads': 'Long reads',
      'short-videos': 'Short videos',
      reposts: 'Reposts',
    } satisfies Record<ContentType, string>,
    strangers: {
      title: 'Posts from strangers',
      description: "Recommended accounts you don't follow.",
    },
  },
  wellbeing: {
    title: 'Wellbeing',
    intro: "Set limits that work for you. We'll stick to them.",
    today: 'Today',
    minutes: (minutes: number) => `${minutes} min`,
    ofLimit: (limit: number) => `of your ${limit} min`,
    noLimit: 'no daily limit set',
    dailyLimit: {
      title: 'Daily time limit',
      description: (minutes: number) => `${minutes} minutes, then a gentle stop.`,
    },
    endOfFeed: {
      title: 'End of feed',
      description: "No endless scroll. Your feed ends when you're caught up.",
    },
    quietHours: {
      title: 'Quiet hours',
      description: (start: string, end: string) => `${start} to ${end}, no notifications.`,
    },
    hideLikeCounts: {
      title: 'Hide like counts',
      description: "On your posts and everyone else's.",
    },
  },
  profile: {
    posts: 'Posts',
    following: 'Following',
    followers: 'Followers',
    hidden: 'Hidden',
    edit: 'Edit profile',
    share: 'Share',
    shareMessage: (handle: string) => `Find me on MNTL: @${handle}`,
    yourPosts: 'Your posts',
    noPosts: "You haven't posted anything yet.",
  },
};

export type Copy = typeof en;
