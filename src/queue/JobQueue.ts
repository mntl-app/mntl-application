import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { AdapterFactory } from '../adapters/AdapterFactory';
import { DataNormalizer } from '../etl/transform/DataNormalizer';
import { InMemoryDataLoader } from '../etl/load/DataLoader';
import { ArchiveStore } from '../etl/load/ArchiveStore';
import { MigrationJob, Platform } from '../types/schemas';
import * as path from 'path';

export interface MigrationJobData {
  zipPath: string;
  userId: string;
  platform?: Platform;
}

export class JobQueue {
  private static instance: JobQueue;
  private queue: Queue;
  private worker: Worker;
  private redis: Redis;
  private dataLoader: InMemoryDataLoader;
  private archiveStore: ArchiveStore;

  private constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.queue = new Queue('migration-jobs', {
      connection: this.redis,
    });
    this.dataLoader = new InMemoryDataLoader();
    this.archiveStore = new ArchiveStore();

    this.worker = new Worker(
      'migration-jobs',
      async (job: Job<MigrationJobData>) => {
        return this.processMigrationJob(job);
      },
      {
        connection: this.redis,
        concurrency: 3,
      }
    );

    this.worker.on('completed', (job: Job) => {
      console.log(`Job ${job.id} completed`);
    });

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      console.error(`Job ${job?.id} failed:`, error);
    });
  }

  static getInstance(): JobQueue {
    if (!JobQueue.instance) {
      JobQueue.instance = new JobQueue();
    }
    return JobQueue.instance;
  }

  async addMigrationJob(data: MigrationJobData): Promise<string> {
    const job = await this.queue.add('migration', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });
    return job.id!;
  }

  async getJobStatus(jobId: string): Promise<MigrationJob | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = job.progress;
    const progressObj = typeof progress === 'object' ? progress : {};

    return {
      jobId: job.id!,
      platform: job.data.platform || 'instagram',
      status: state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : state === 'active' ? 'processing' : 'pending',
      progress: typeof progress === 'number' ? progress : 0,
      startedAt: job.timestamp ? new Date(job.timestamp) : undefined,
      completedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
      error: job.failedReason,
      totalPosts: (progressObj as any)?.totalPosts || 0,
      processedPosts: (progressObj as any)?.processedPosts || 0,
    };
  }

  private async processMigrationJob(job: Job<MigrationJobData>): Promise<void> {
    const { zipPath, userId } = job.data;

    try {
      await job.updateProgress(10);

      const adapter = AdapterFactory.getAdapter(zipPath);
      if (!adapter) {
        throw new Error('Unable to detect platform from archive');
      }

      await job.updateProgress(20);

      const isValid = await adapter.validateArchive(zipPath);
      if (!isValid) {
        throw new Error('Invalid archive file');
      }

      await job.updateProgress(30);

      const archiveId = path.basename(zipPath);
      const posts = (await adapter.extractPosts(zipPath)).map(post => ({
        ...post,
        mediaUrls: post.mediaUrls?.map(
          entry => `/api/media?archiveId=${encodeURIComponent(archiveId)}&entry=${encodeURIComponent(entry)}`
        ),
      }));
      const currentProgress = typeof job.progress === 'object' ? job.progress : {};
      await job.updateProgress({ ...currentProgress, totalPosts: posts.length, processedPosts: 0 });

      const users = await adapter.extractUsers(zipPath);
      const archiveOwnerId = users.find(user => user.username !== 'unknown')?.username || userId;
      await job.updateProgress(40);

      const followRelations = await adapter.extractFollowRelations(zipPath);
      await job.updateProgress(50);

      const likes = await adapter.extractLikes(zipPath);
      await job.updateProgress(60);

      await job.updateProgress(70);

      const normalizedData = DataNormalizer.normalizeAll({
        posts,
        users,
        followRelations,
        likes,
      });
      normalizedData.followRelations = normalizedData.followRelations.map(relation => ({
        ...relation,
        followerId: relation.followerId === 'me' ? archiveOwnerId : relation.followerId,
        followingId: relation.followingId === 'me' ? archiveOwnerId : relation.followingId,
      }));
      normalizedData.likes = normalizedData.likes.map(like => ({
        ...like,
        userId: like.userId === 'me' ? archiveOwnerId : like.userId,
      }));
      await job.updateProgress(80);

      await this.dataLoader.connect();
      await this.dataLoader.savePosts(normalizedData.posts);
      await this.dataLoader.saveUsers(normalizedData.users);
      await this.dataLoader.saveFollowRelations(normalizedData.followRelations);
      await this.dataLoader.saveLikes(normalizedData.likes);
      await this.dataLoader.disconnect();

      await this.archiveStore.save({
        archiveId,
        ownerId: archiveOwnerId,
        platform: adapter.platform,
        importedAt: new Date().toISOString(),
        followers: [...new Set(normalizedData.followRelations
          .filter(relation => relation.followingId === archiveOwnerId)
          .map(relation => relation.followerId))],
        following: [...new Set(normalizedData.followRelations
          .filter(relation => relation.followerId === archiveOwnerId)
          .map(relation => relation.followingId))],
        posts: normalizedData.posts,
        likes: normalizedData.likes,
      });

      const importedPostKeys = new Set(
        normalizedData.posts.map(post => `${post.platform}\u0000${post.originalPlatformId}`)
      );
      for (const match of this.dataLoader.getLikeMatches()) {
        if (
          match.matchedPost &&
          importedPostKeys.has(`${match.matchedPost.platform}\u0000${match.matchedPost.originalPlatformId}`)
        ) {
          console.info(
            `Crossmatched ${match.like.platform} target ${match.like.postId} to uploaded post ${match.matchedPost.originalPlatformId} by ${match.matchType}`
          );
        }
      }

      await job.updateProgress(100);

    } catch (error) {
      console.error('Migration job failed:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    await this.redis.quit();
  }
}
