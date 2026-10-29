import { InMemoryDataLoader } from '../etl/load/DataLoader';
import { ArchiveStore } from '../etl/load/ArchiveStore';
import { MigrationJob } from '../types/schemas';
import { ZipExtractor } from '../etl/extract/ZipExtractor';
import { MigrationJobData, runMigrationPipeline } from './MigrationPipeline';

export type { MigrationJobData } from './MigrationPipeline';

interface StoredJob {
  id: string;
  data: MigrationJobData;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  warnings?: string[];
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
      warnings: job.warnings,
      totalPosts: job.totalPosts,
      processedPosts: job.processedPosts,
    };
  }

  private async processMigrationJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      job.status = 'processing';
      job.startedAt = new Date();
      const result = await runMigrationPipeline(job.data, this.dataLoader, this.archiveStore, async update => {
        job.progress = update.progress;
        if (update.totalPosts !== undefined) {
          job.totalPosts = update.totalPosts;
          job.processedPosts = 0;
        }
      });

      job.warnings = result.warnings.length ? result.warnings : undefined;
      job.status = 'completed';
      job.completedAt = new Date();
      console.log(`Job ${jobId} completed`);
    } catch (error) {
      console.error(`Job ${jobId} failed:`, error);
      job.status = 'failed';
      job.completedAt = new Date();
      job.error = error instanceof Error ? error.message : String(error);
    } finally {
      // The raw export holds far more than is imported, so it is never kept.
      await ZipExtractor.delete(job.data.zipPath);
    }
  }

  getJobOwnerId(jobId: string): string | null {
    return this.jobs.get(jobId)?.data.mntlUserId ?? null;
  }

  async close(): Promise<void> {
    this.jobs.clear();
  }
}
