import * as path from 'path';
import { AdapterFactory } from '../adapters/AdapterFactory';
import { TikTokMediaDownloader } from '../adapters/tiktok/TikTokMediaDownloader';
import { extractPostMedia } from '../etl/extract/MediaExtractor';
import { minimizeComment, minimizeLike } from '../etl/load/Identity';
import { DataNormalizer } from '../etl/transform/DataNormalizer';
import { InMemoryDataLoader } from '../etl/load/DataLoader';
import { ArchiveStore } from '../etl/load/ArchiveStore';
import { Platform } from '../types/schemas';

export interface MigrationJobData {
  zipPath: string;
  userId: string;
  mntlUserId: string;
  mntlHandle: string;
  platform?: Platform;
}

export interface MigrationProgress {
  progress: number;
  totalPosts?: number;
}

export interface MigrationResult {
  warnings: string[];
}

export async function runMigrationPipeline(
  data: MigrationJobData,
  dataLoader: InMemoryDataLoader,
  archiveStore: ArchiveStore,
  reportProgress: (update: MigrationProgress) => Promise<void>
): Promise<MigrationResult> {
  const { zipPath, userId } = data;
  await reportProgress({ progress: 10 });

  const adapter = AdapterFactory.getAdapter(zipPath);
  if (!adapter) {
    throw new Error('Unable to detect platform from archive');
  }

  await reportProgress({ progress: 20 });

  const isValid = await adapter.validateArchive(zipPath);
  if (!isValid) {
    throw new Error('Invalid archive file');
  }
  const warnings = await adapter.describeLimitations(zipPath);

  await reportProgress({ progress: 30 });

  const archiveId = path.basename(zipPath);
  const extractedPosts = await adapter.extractPosts(zipPath);
  const downloadedPosts = adapter.platform === 'tiktok'
    ? await new TikTokMediaDownloader().downloadOwnPostedVideos(extractedPosts, archiveId)
    : extractedPosts;
  const localPosts = await extractPostMedia(zipPath, archiveId, downloadedPosts);
  const posts = localPosts.map(post => ({
    ...post,
    mediaUrls: post.mediaUrls?.map(
      entry => entry.startsWith('/api/media?')
        ? entry
        : `/api/media?archiveId=${encodeURIComponent(archiveId)}&entry=${encodeURIComponent(entry)}`
    ),
  }));
  await reportProgress({ progress: 40, totalPosts: posts.length });

  const users = await adapter.extractUsers(zipPath);
  const archiveOwner = users.find(user => user.username !== 'unknown');
  const archiveOwnerId = adapter.platform === 'x'
    ? archiveOwner?.originalPlatformId || userId
    : archiveOwner?.username || userId;
  await reportProgress({ progress: 50 });

  const followRelations = await adapter.extractFollowRelations(zipPath);
  await reportProgress({ progress: 60 });

  const likes = await adapter.extractLikes(zipPath);
  await reportProgress({ progress: 70 });

  const comments = await adapter.extractComments(zipPath);
  await reportProgress({ progress: 80 });

  const normalizedData = DataNormalizer.normalizeAll({
    posts,
    users,
    followRelations,
    likes,
    comments,
  });
  normalizedData.followRelations = normalizedData.followRelations.map(relation => ({
    ...relation,
    followerId: relation.followerId === 'me' ? archiveOwnerId : relation.followerId,
    followingId: relation.followingId === 'me' ? archiveOwnerId : relation.followingId,
  }));
  // Other people's post text and identities are fingerprinted before anything is stored.
  normalizedData.likes = normalizedData.likes.map(like => minimizeLike({
    ...like,
    userId: like.userId === 'me' ? archiveOwnerId : like.userId,
  }));
  normalizedData.comments = normalizedData.comments.map(minimizeComment);
  await reportProgress({ progress: 90 });

  const follows = normalizedData.followRelations.filter(relation => relation.relationship !== 'friend');
  const friendships = normalizedData.followRelations.filter(relation =>
    relation.relationship === 'friend' && relation.followerId === archiveOwnerId
  );

  await dataLoader.connect();
  await dataLoader.savePosts(normalizedData.posts);
  await dataLoader.saveUsers(normalizedData.users);
  await dataLoader.saveFollowRelations(normalizedData.followRelations);
  await dataLoader.saveLikes(normalizedData.likes);
  await dataLoader.saveComments(normalizedData.comments);
  await dataLoader.disconnect();

  await archiveStore.save({
    archiveId,
    ownerId: archiveOwnerId,
    ownerHandle: archiveOwner?.username,
    ownerName: archiveOwner?.displayName,
    mntlUserId: data.mntlUserId,
    mntlHandle: data.mntlHandle,
    platform: adapter.platform,
    importedAt: new Date().toISOString(),
    importWarnings: warnings.length ? warnings : undefined,
    followers: [...new Set(follows
      .filter(relation => relation.followingId === archiveOwnerId)
      .map(relation => relation.followerId))],
    following: [...new Set(follows
      .filter(relation => relation.followerId === archiveOwnerId)
      .map(relation => relation.followingId))],
    friends: adapter.platform === 'facebook'
      ? [...new Set(friendships.map(relation => relation.followingId))]
      : undefined,
    posts: normalizedData.posts,
    likes: normalizedData.likes,
    comments: normalizedData.comments,
  });

  const importedPostKeys = new Set(
    normalizedData.posts.map(post => `${post.platform}\u0000${post.originalPlatformId}`)
  );
  for (const match of dataLoader.getLikeMatches()) {
    if (
      match.matchedPost &&
      importedPostKeys.has(`${match.matchedPost.platform}\u0000${match.matchedPost.originalPlatformId}`)
    ) {
      console.info(
        `Crossmatched ${match.like.platform} target ${match.like.postId} to uploaded post ${match.matchedPost.originalPlatformId} by ${match.matchType}`
      );
    }
  }

  await reportProgress({ progress: 100 });
  return { warnings };
}
