import { createHash } from 'crypto';
import {
  NormalizedActivity,
  NormalizedComment,
  NormalizedLike,
  NormalizedPost,
  Platform,
} from '../../types/schemas';
import { accountKey, likeTextKey, nameKey, postOwnerKeys, textKey } from './Identity';

interface ActivityArchive {
  ownerId: string;
  ownerHandle?: string;
  ownerName?: string;
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

type ActivityPost = { archive: ActivityArchive; post: NormalizedPost };

class TargetPostIndex {
  private readonly firstIndexById = new Map<string, number>();
  private readonly byText = new Map<string, ActivityPost[]>();

  constructor(private readonly posts: ActivityPost[]) {
    posts.forEach((entry, index) => {
      const idKey = `${entry.post.platform}\u0000${entry.post.originalPlatformId}`;
      if (!this.firstIndexById.has(idKey)) this.firstIndexById.set(idKey, index);
      const contentKey = textKey(entry.post.platform, entry.post.content);
      if (!contentKey) return;
      this.byText.set(contentKey, [...(this.byText.get(contentKey) || []), entry]);
    });
  }

  find(
    platform: Platform,
    postId: string,
    postShortcode: string | undefined,
    url: string | undefined,
    likedTextKey: string | undefined
  ): ActivityPost | undefined {
    const instagramShortcode = url?.match(/\/(?:p|reel|reels|tv)\/([^/?]+)/i)?.[1];
    const candidateIndexes = [postId, postShortcode, instagramShortcode]
      .flatMap(id => {
        const index = id === undefined ? undefined : this.firstIndexById.get(`${platform}\u0000${id}`);
        return index === undefined ? [] : [index];
      });
    if (candidateIndexes.length) return this.posts[Math.min(...candidateIndexes)];

    if (likedTextKey) {
      const matches = this.byText.get(likedTextKey) || [];
      if (matches.length === 1) return matches[0];
    }
    return undefined;
  }
}

// Finds the MNTL account behind a post owner's ID, handle, or display name fingerprint. Used when
// the target post itself is not in any archive, e.g. Facebook reactions whose post
// IDs never appear in the owner's export.
class PostOwnerIndex {
  private readonly byAccount = new Map<string, ActivityArchive[]>();
  private readonly byName = new Map<string, ActivityArchive[]>();

  constructor(archives: ActivityArchive[]) {
    for (const archive of archives) {
      const accountKeys = new Set([archive.ownerId, archive.ownerHandle].map(id => accountKey(archive.platform, id)));
      for (const key of accountKeys) {
        if (key) this.add(this.byAccount, key, archive);
      }
      const ownerNameKey = nameKey(archive.platform, archive.ownerName);
      if (ownerNameKey) this.add(this.byName, ownerNameKey, archive);
    }
  }

  private add(index: Map<string, ActivityArchive[]>, key: string, archive: ActivityArchive) {
    index.set(key, [...(index.get(key) || []), archive]);
  }

  find(owner: { idKey?: string; nameKey?: string }): ActivityArchive | undefined {
    const candidates = [
      owner.idKey ? this.byAccount.get(owner.idKey) : undefined,
      owner.nameKey ? this.byName.get(owner.nameKey) : undefined,
    ];
    for (const archives of candidates) {
      if (archives?.length && new Set(archives.map(archive => archive.mntlUserId)).size === 1) {
        return archives[0];
      }
    }
    return undefined;
  }
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
  posts: ActivityPost[],
  accountArchives: ActivityArchive[] = []
): NormalizedActivity[] {
  const activities = new Map<string, NormalizedActivity>();
  const postIndex = new TargetPostIndex(posts);
  const ownerIndex = new PostOwnerIndex(accountArchives);

  for (const archive of archives) {
    if (archive.platform === 'tiktok') continue;

    const add = (
      type: NormalizedActivity['type'],
      postId: string,
      postShortcode: string | undefined,
      postUrl: string | undefined,
      likedTextKey: string | undefined,
      content: string | undefined,
      occurredAt: Date | undefined,
      owner: { idKey?: string; nameKey?: string },
      sourceId?: string
    ) => {
      const target = postIndex.find(archive.platform, postId, postShortcode, postUrl, likedTextKey);
      const ownerArchive = target?.archive || ownerIndex.find(owner);
      const activityId = stableActivityId(
        archive.platform,
        archive.ownerId,
        type,
        sourceId || postId,
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
          platformPostId: target?.post.originalPlatformId || postId,
          type: targetType(target?.post),
          // Only MNTL users' own posts are shown; other people's text is never stored.
          text: target?.post.content,
          url: postUrl,
          mediaUrls: target?.post.mediaUrls,
          mediaTypes: target?.post.mediaTypes,
          ownerMntlUserId: ownerArchive?.mntlUserId,
          ownerHandle: ownerArchive?.mntlHandle,
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
        likeTextKey(like),
        undefined,
        like.likedAt,
        postOwnerKeys(like)
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
        postOwnerKeys(comment),
        comment.originalPlatformId
      );
    }
  }

  return [...activities.values()].sort((left, right) =>
    (right.occurredAt?.getTime() || 0) - (left.occurredAt?.getTime() || 0)
  );
}
