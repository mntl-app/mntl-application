import { createHash } from 'crypto';
import {
  NormalizedActivity,
  NormalizedComment,
  NormalizedLike,
  NormalizedPost,
  Platform,
} from '../../types/schemas';

interface ActivityArchive {
  ownerId: string;
  ownerHandle?: string;
  mntlUserId: string;
  mntlHandle: string;
  platform: Platform;
  likes: NormalizedLike[];
  comments?: NormalizedComment[];
}

function stableActivityId(
  platform: Platform,
  actorId: string,
  type: NormalizedActivity['type'],
  targetId: string,
  occurredAt: Date | undefined,
  content?: string
): string {
  return createHash('sha256')
    .update([
      platform,
      actorId.trim().toLowerCase(),
      type,
      targetId.trim(),
      occurredAt?.toISOString() || '',
      content || '',
    ].join('\u0000'))
    .digest('hex');
}

function findTargetPost(
  platform: Platform,
  postId: string,
  postShortcode: string | undefined,
  url: string | undefined,
  text: string | undefined,
  posts: Array<{ archive: ActivityArchive; post: NormalizedPost }>
): { archive: ActivityArchive; post: NormalizedPost } | undefined {
  const resolvedId = postId;
  const instagramShortcode = url?.match(/\/(?:p|reel|reels|tv)\/([^/?]+)/i)?.[1];
  const byId = posts.find(entry =>
    entry.post.platform === platform &&
    (entry.post.originalPlatformId === resolvedId ||
      entry.post.originalPlatformId === postId ||
      entry.post.originalPlatformId === postShortcode ||
      entry.post.originalPlatformId === instagramShortcode)
  );
  if (byId) return byId;

  if (text) {
    const normalizedText = text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
    const matches = posts.filter(entry =>
      entry.post.platform === platform &&
      entry.post.content &&
      entry.post.content.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ') === normalizedText
    );
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

function targetType(post: NormalizedPost | undefined): NormalizedActivity['target']['type'] {
  if (!post) return 'unknown';
  if (post.isReply) return 'reply';
  if (post.postType) return post.postType;
  if (post.mediaTypes?.includes('video')) return 'reel';
  if (post.mediaUrls?.length) return 'post';
  return 'text';
}

export function normalizeMntlActivities(
  archives: ActivityArchive[],
  posts: Array<{ archive: ActivityArchive; post: NormalizedPost }>
): NormalizedActivity[] {
  const activities = new Map<string, NormalizedActivity>();

  for (const archive of archives) {
    if (archive.platform === 'tiktok') continue;

    const add = (
      type: NormalizedActivity['type'],
      postId: string,
      postShortcode: string | undefined,
      postUrl: string | undefined,
      postText: string | undefined,
      content: string | undefined,
      occurredAt: Date | undefined,
      sourceId?: string
    ) => {
      const target = findTargetPost(
        archive.platform,
        postId,
        postShortcode,
        postUrl,
        postText,
        posts
      );
      const resolvedPostId = postId;
      const activityId = stableActivityId(
        archive.platform,
        archive.ownerId,
        type,
        sourceId || resolvedPostId,
        occurredAt,
        content
      );
      activities.set(activityId, {
        activityId,
        type,
        platform: archive.platform,
        actor: {
          mntlUserId: archive.mntlUserId,
          platformAccountId: archive.ownerId,
        },
        target: {
          platformPostId: target?.post.originalPlatformId || resolvedPostId,
          type: targetType(target?.post),
          text: target?.post.content || postText || undefined,
          url: postUrl,
          mediaUrls: target?.post.mediaUrls,
          mediaTypes: target?.post.mediaTypes,
          ownerMntlUserId: target?.archive.mntlUserId,
          ownerHandle: target?.archive.mntlHandle,
        },
        content,
        occurredAt,
      });
    };

    for (const like of archive.likes) {
      add(
        'like',
        like.postId,
        like.postShortcode,
        like.postUrl,
        like.postText,
        undefined,
        like.likedAt
      );
    }
    for (const comment of archive.comments || []) {
      add(
        'comment',
        comment.postId,
        undefined,
        comment.postUrl,
        undefined,
        comment.content,
        comment.createdAt,
        comment.originalPlatformId
      );
    }
  }

  return [...activities.values()].sort((left, right) =>
    (right.occurredAt?.getTime() || 0) - (left.occurredAt?.getTime() || 0)
  );
}
