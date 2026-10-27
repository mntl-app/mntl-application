import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { NormalizedPost } from '../../types/schemas';

const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_ARCHIVE_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_ARCHIVE_VIDEO_COUNT = 1000;
const MAX_REDIRECTS = 3;
const ALLOWED_TIKTOK_DOMAINS = [
  'tiktok.com',
  'tiktokv.com',
  'tiktokv.eu',
  'tiktokcdn.com',
  'tiktokcdn-eu.com',
  'tiktokcdn-us.com',
];

type Fetcher = typeof fetch;

function isAllowedTikTokUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (!url.port || url.port === '443') &&
      !url.username &&
      !url.password &&
      ALLOWED_TIKTOK_DOMAINS.some(domain =>
        url.hostname === domain || url.hostname.endsWith(`.${domain}`)
      );
  } catch {
    return false;
  }
}

export class TikTokMediaDownloader {
  constructor(
    private readonly storageDirectory = path.join(process.cwd(), 'data', 'media'),
    private readonly fetcher: Fetcher = fetch
  ) {}

  async downloadOwnPostedVideos(posts: NormalizedPost[], archiveId: string): Promise<NormalizedPost[]> {
    if (!/^[a-f0-9]{32}$/i.test(archiveId)) {
      throw new Error('Invalid TikTok archive identifier for media storage');
    }

    const outputDirectory = path.join(this.storageDirectory, archiveId);
    let totalBytes = 0;
    let downloadedCount = 0;
    const updatedPosts = posts.map(post => ({ ...post, mediaUrls: post.mediaUrls && [...post.mediaUrls] }));
    const videoCount = updatedPosts.filter(post =>
      post.platform === 'tiktok' &&
      post.mediaTypes?.includes('video') &&
      post.mediaUrls?.some(url => /^https?:\/\//i.test(url))
    ).length;
    if (videoCount > MAX_ARCHIVE_VIDEO_COUNT) {
      throw new Error(`TikTok archive exceeds the ${MAX_ARCHIVE_VIDEO_COUNT}-video download limit`);
    }

    try {
      for (const [postIndex, post] of updatedPosts.entries()) {
        const videoUrl = post.platform === 'tiktok' && post.mediaTypes?.includes('video')
          ? post.mediaUrls?.find(url => /^https?:\/\//i.test(url))
          : undefined;
        if (!videoUrl) continue;

        const targetPath = path.join(outputDirectory, `video-${postIndex}.mp4`);
        const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
        const byteLimit = Math.min(MAX_VIDEO_BYTES, MAX_ARCHIVE_VIDEO_BYTES - totalBytes);
        if (byteLimit <= 0) throw new Error('TikTok videos exceed the total archive download limit');
        let downloadedBytes: number;
        try {
          downloadedBytes = await this.downloadVideo(videoUrl, temporaryPath, byteLimit);
        } catch (error) {
          if (!this.isDownloadTimeout(error)) throw error;
          await fs.rm(temporaryPath, { force: true });
          console.warn(
            `TikTok video download timed out for archive ${archiveId}, post ${post.originalPlatformId}; keeping the archive URL`
          );
          continue;
        }
        await fs.rename(temporaryPath, targetPath);
        totalBytes += downloadedBytes;
        downloadedCount++;
        post.mediaUrls = [`media/tiktok/video-${postIndex}.mp4`];
      }
    } catch (error) {
      await fs.rm(outputDirectory, { recursive: true, force: true });
      throw error;
    }

    if (downloadedCount > 0) {
      console.info(`Downloaded ${downloadedCount} TikTok post video(s) into local media storage`);
    }
    return updatedPosts;
  }

  private isDownloadTimeout(error: unknown): boolean {
    return error instanceof DOMException &&
      (error.name === 'AbortError' || error.name === 'TimeoutError');
  }

  private async downloadVideo(url: string, targetPath: string, byteLimit: number): Promise<number> {
    let currentUrl = url;
    let response: Response | undefined;

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      if (!isAllowedTikTokUrl(currentUrl)) {
        throw new Error('TikTok video URL is not on an approved HTTPS host');
      }

      response = await this.fetcher(currentUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(60_000),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;

      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error('TikTok video download exceeded the redirect limit');
      }
      currentUrl = new URL(location, currentUrl).toString();
    }

    if (!response?.ok || !response.body) {
      throw new Error(`TikTok video download failed with HTTP ${response?.status ?? 'unknown'}`);
    }
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith('video/') && contentType !== 'application/octet-stream') {
      await response.body.cancel();
      throw new Error('TikTok video URL did not return video content');
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > byteLimit) {
      await response.body.cancel();
      throw new Error('TikTok video exceeds the per-video download limit');
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    let downloadedBytes = 0;
    const file = await fs.open(targetPath, 'wx', 0o600);
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        downloadedBytes += value.byteLength;
        if (downloadedBytes > byteLimit) {
          await reader.cancel();
          throw new Error('TikTok video exceeds the per-video download limit');
        }
        await file.write(value);
      }
      if (downloadedBytes === 0) throw new Error('TikTok video download was empty');
      return downloadedBytes;
    } finally {
      reader.releaseLock();
      await file.close();
    }
  }
}
