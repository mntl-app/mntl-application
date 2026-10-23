import type { ApiClient } from '../client';
import type { ExplanationReason, Level, Page, Post, Session } from '../types';
import * as fixtures from './fixtures';

const PAGE_SIZE = 5;
const RECENT_HOURS = 24;
const LEVEL_WEIGHT: Record<Level, number> = { less: 0, balanced: 1, more: 2 };

/** Deep copy, so callers can never mutate the in-memory "database" by accident. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function paginate<T>(items: T[], cursor?: string | null): Page<T> {
  const start = cursor ? Number(cursor) : 0;
  const end = start + PAGE_SIZE;
  return { items: items.slice(start, end), nextCursor: end < items.length ? String(end) : null };
}

const byNewest = (a: Post, b: Post) => b.createdAt.localeCompare(a.createdAt);
const hoursSince = (date: string) => (Date.now() - new Date(date).getTime()) / 3_600_000;

/**
 * In-memory backend with simulated latency. State lives for the lifetime of the JS bundle,
 * so a reload starts from the fixtures again (including onboarding).
 */
export function createMockClient({ latencyMs = 200 }: { latencyMs?: number } = {}): ApiClient {
  const db = {
    session: { user: fixtures.me, onboardingCompleted: false } as Session,
    posts: clone(fixtures.posts),
    preferences: clone(fixtures.algorithmPreferences),
    wellbeing: clone(fixtures.wellbeingSettings),
    usage: clone(fixtures.usageToday),
  };

  const respond = <T>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(clone(value)), latencyMs));

  const levelFor = (topicId: string) =>
    db.preferences.topics.find((p) => p.topic.id === topicId)?.level;

  const feedPosts = () => db.posts.filter((post) => post.author.id !== db.session.user.id);
  const isFollowed = (post: Post) => fixtures.followingIds.has(post.author.id);

  return {
    getSession: () => respond(db.session),

    completeOnboarding: ({ topicIds }) => {
      for (const topic of fixtures.topics.filter((t) => topicIds.includes(t.id))) {
        const existing = db.preferences.topics.find((p) => p.topic.id === topic.id);
        if (existing) existing.level = 'more';
        else db.preferences.topics.push({ topic, level: 'more' });
      }
      db.session = { ...db.session, onboardingCompleted: true };
      return respond(db.session);
    },

    getTopics: () => respond(fixtures.topics),

    getFeed: ({ mode, cursor }) => {
      const visible = feedPosts().filter((post) => db.preferences.showStrangers || isFollowed(post));
      let ranked: Post[];
      if (mode === 'following') {
        ranked = feedPosts().filter(isFollowed).sort(byNewest);
      } else if (mode === 'latest') {
        ranked = [...visible].sort(byNewest);
      } else {
        const weight = (post: Post) => LEVEL_WEIGHT[levelFor(post.topic.id) ?? 'balanced'];
        ranked = [...visible].sort((a, b) => weight(b) - weight(a) || byNewest(a, b));
      }
      return respond(paginate(ranked, cursor));
    },

    getUserPosts: ({ userId, cursor }) =>
      respond(paginate(db.posts.filter((p) => p.author.id === userId).sort(byNewest), cursor)),

    getPostExplanation: (postId) => {
      const post = db.posts.find((p) => p.id === postId);
      if (!post) return Promise.reject(new Error(`Post ${postId} not found`));

      const reasons: ExplanationReason[] = [];
      const level = levelFor(post.topic.id);
      if (level) reasons.push({ kind: 'topic-level', topic: post.topic, level });
      if (isFollowed(post)) reasons.push({ kind: 'follows-author', handle: post.author.handle });
      if (hoursSince(post.createdAt) < RECENT_HOURS) {
        reasons.push({ kind: 'recent', withinHours: RECENT_HOURS });
      }
      return respond({ postId, reasons, topic: post.topic });
    },

    getAlgorithmPreferences: () => respond(db.preferences),
    updateAlgorithmPreferences: (patch) => {
      db.preferences = { ...db.preferences, ...clone(patch) };
      return respond(db.preferences);
    },

    getWellbeingSettings: () => respond(db.wellbeing),
    updateWellbeingSettings: (patch) => {
      db.wellbeing = { ...db.wellbeing, ...clone(patch) };
      return respond(db.wellbeing);
    },

    getUsageToday: () => respond(db.usage),
  };
}
