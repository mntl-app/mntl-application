import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { InMemoryDataLoader } from '../etl/load/DataLoader';
import { ArchiveStore } from '../etl/load/ArchiveStore';
import { MigrationJob } from '../types/schemas';
import { ZipExtractor } from '../etl/extract/ZipExtractor';
import { MigrationJobData, MigrationProgress, MigrationResult, runMigrationPipeline } from './MigrationPipeline';

export type { MigrationJobData } from './MigrationPipeline';

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

    // The raw export holds far more than is imported, so it is never kept.
    this.worker.on('completed', async (job: Job<MigrationJobData>) => {
      console.log(`Job ${job.id} completed`);
      await ZipExtractor.delete(job.data.zipPath);
    });

    this.worker.on('failed', async (job: Job<MigrationJobData> | undefined, error: Error) => {
      console.error(`Job ${job?.id} failed:`, error);
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        await ZipExtractor.delete(job.data.zipPath);
      }
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

  async getJobOwnerId(jobId: string): Promise<string | null> {
    const job = await this.queue.getJob(jobId);
    return job?.data.mntlUserId ?? null;
  }

  async getJobStatus(jobId: string): Promise<MigrationJob | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = (typeof job.progress === 'object' ? job.progress : {}) as Partial<MigrationProgress>;

    return {
      jobId: job.id!,
      platform: job.data.platform || 'instagram',
      status: state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : state === 'active' ? 'processing' : 'pending',
      progress: progress.progress || 0,
      startedAt: job.timestamp ? new Date(job.timestamp) : undefined,
      completedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
      error: job.failedReason,
      warnings: job.returnvalue?.warnings?.length ? job.returnvalue.warnings : undefined,
      totalPosts: progress.totalPosts || 0,
      processedPosts: 0,
    };
  }

  private async processMigrationJob(job: Job<MigrationJobData>): Promise<MigrationResult> {
    let totalPosts = 0;
    return runMigrationPipeline(job.data, this.dataLoader, this.archiveStore, async update => {
      totalPosts = update.totalPosts ?? totalPosts;
      await job.updateProgress({ progress: update.progress, totalPosts });
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    await this.redis.quit();
  }
}
