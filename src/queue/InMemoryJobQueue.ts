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

interface StoredJob {
  id: string;
  data: MigrationJobData;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  totalPosts: number;
  processedPosts: number;
}

export class InMemoryJobQueue {
  private static instance: InMemoryJobQueue;
  private jobs: Map<string, StoredJob> = new Map();
  private dataLoader: InMemoryDataLoader;
  private archiveStore: ArchiveStore;
  private jobIdCounter = 0;

  private constructor() {
    this.dataLoader = new InMemoryDataLoader();
    this.archiveStore = new ArchiveStore();
  }

  static getInstance(): InMemoryJobQueue {
    if (!InMemoryJobQueue.instance) {
      InMemoryJobQueue.instance = new InMemoryJobQueue();
    }
    return InMemoryJobQueue.instance;
  }

  async addMigrationJob(data: MigrationJobData): Promise<string> {
    const jobId = `job_${++this.jobIdCounter}`;
    const job: StoredJob = {
      id: jobId,
      data,
      status: 'pending',
      progress: 0,
      totalPosts: 0,
      processedPosts: 0,
    };

    this.jobs.set(jobId, job);

    // Process job asynchronously
    this.processMigrationJob(jobId).catch(error => {
      console.error(`Job ${jobId} failed:`, error);
    });

    return jobId;
  }

  async getJobStatus(jobId: string): Promise<MigrationJob | null> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    return {
      jobId: job.id,
      platform: job.data.platform || 'instagram',
      status: job.status,
      progress: job.progress,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      totalPosts: job.totalPosts,
      processedPosts: job.processedPosts,
    };
  }

  private async updateJobProgress(jobId: string, progress: number | object): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    if (typeof progress === 'number') {
      job.progress = progress;
    } else {
      Object.assign(job, progress);
    }
  }

  private async processMigrationJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      job.status = 'processing';
      job.startedAt = new Date();
      await this.updateJobProgress(jobId, 10);

      const adapter = AdapterFactory.getAdapter(job.data.zipPath);
      if (!adapter) {
        throw new Error('Unable to detect platform from archive');
      }

      await this.updateJobProgress(jobId, 20);

      const isValid = await adapter.validateArchive(job.data.zipPath);
      if (!isValid) {
        throw new Error('Invalid archive file');
      }

      await this.updateJobProgress(jobId, 30);

      const archiveId = path.basename(job.data.zipPath);
      const posts = (await adapter.extractPosts(job.data.zipPath)).map(post => ({
        ...post,
        mediaUrls: post.mediaUrls?.map(
          entry => `/api/media?archiveId=${encodeURIComponent(archiveId)}&entry=${encodeURIComponent(entry)}`
        ),
      }));
      job.totalPosts = posts.length;
      await this.updateJobProgress(jobId, { progress: 40, totalPosts: posts.length, processedPosts: 0 });

      const users = await adapter.extractUsers(job.data.zipPath);
      const archiveOwner = users.find(user => user.username !== 'unknown');
      const archiveOwnerId = adapter.platform === 'x'
        ? archiveOwner?.originalPlatformId || job.data.userId
        : archiveOwner?.username || job.data.userId;
      await this.updateJobProgress(jobId, 50);

      const followRelations = await adapter.extractFollowRelations(job.data.zipPath);
      await this.updateJobProgress(jobId, 60);

      const likes = await adapter.extractLikes(job.data.zipPath);
      await this.updateJobProgress(jobId, 70);

      await this.updateJobProgress(jobId, 80);

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
      await this.updateJobProgress(jobId, 90);

      await this.dataLoader.connect();
      await this.dataLoader.savePosts(normalizedData.posts);
      await this.dataLoader.saveUsers(normalizedData.users);
      await this.dataLoader.saveFollowRelations(normalizedData.followRelations);
      await this.dataLoader.saveLikes(normalizedData.likes);
      await this.dataLoader.disconnect();

      await this.archiveStore.save({
        archiveId,
        ownerId: archiveOwnerId,
        ownerHandle: archiveOwner?.username,
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

      await this.updateJobProgress(jobId, 100);

      job.status = 'completed';
      job.completedAt = new Date();
      console.log(`Job ${jobId} completed`);
    } catch (error) {
      console.error(`Job ${jobId} failed:`, error);
      job.status = 'failed';
      job.completedAt = new Date();
      job.error = error instanceof Error ? error.message : String(error);
    }
  }

  async close(): Promise<void> {
    this.jobs.clear();
  }

  getDataLoader(): InMemoryDataLoader {
    return this.dataLoader;
  }
}
