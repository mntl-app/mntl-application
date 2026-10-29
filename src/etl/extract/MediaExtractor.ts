import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { NormalizedPost } from '../../types/schemas';
import { ZipExtractor } from './ZipExtractor';

export const MEDIA_ROOT = path.join(process.cwd(), 'data', 'media');

const ARCHIVE_ID_PATTERN = /^[a-f0-9]{32}$/i;
const STORED_FILE_PATTERN = /^[a-f0-9]{32}(?:\.[a-z0-9]{1,5})?$/i;
const TIKTOK_VIDEO_PATTERN = /^media\/tiktok\/video-\d+\.mp4$/i;
// Instagram, X, and Facebook folders that hold post media (never messages).
const POST_MEDIA_PREFIXES = ['media/', 'data/tweets_media/', 'your_facebook_activity/posts/media/'];

function isPostMediaEntry(entryName: string): boolean {
  return POST_MEDIA_PREFIXES.some(prefix => entryName.startsWith(prefix)) &&
    !entryName.split('/').some(segment => segment === '.' || segment === '..');
}

// Resolves a media entry from a post's media URL to its file in local storage.
export function storedMediaPath(archiveId: string, entry: string, mediaRoot = MEDIA_ROOT): string | null {
  if (!ARCHIVE_ID_PATTERN.test(archiveId)) return null;
  const normalizedEntry = entry.replace(/\\/g, '/');
  const isStoredFile = STORED_FILE_PATTERN.test(normalizedEntry) || TIKTOK_VIDEO_PATTERN.test(normalizedEntry);
  return isStoredFile ? path.join(mediaRoot, archiveId, path.basename(normalizedEntry)) : null;
}

// Copies the archive entries referenced by posts into local media storage, so the
// uploaded ZIP can be deleted after import. Unresolvable entries are left unchanged.
export async function extractPostMedia(
  zipPath: string,
  archiveId: string,
  posts: NormalizedPost[],
  mediaRoot = MEDIA_ROOT
): Promise<NormalizedPost[]> {
  if (!ARCHIVE_ID_PATTERN.test(archiveId)) {
    throw new Error('Invalid archive identifier for media storage');
  }

  const entries = ZipExtractor.open(zipPath).getEntries().filter(entry => !entry.isDirectory);
  const entriesByName = new Map(entries.map(entry => [entry.entryName.replace(/\\/g, '/'), entry]));
  const outputDirectory = path.join(mediaRoot, archiveId);
  const storedNames = new Map<string, string | null>();

  const store = async (uri: string): Promise<string | null> => {
    const normalizedUri = uri.replace(/\\/g, '/');
    if (!isPostMediaEntry(normalizedUri)) return null;

    const matchingEntries = entriesByName.has(normalizedUri)
      ? [entriesByName.get(normalizedUri)!]
      : entries.filter(entry => entry.entryName.replace(/\\/g, '/').endsWith(`/${normalizedUri}`));
    if (matchingEntries.length !== 1) return null;

    const extension = path.extname(normalizedUri).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6);
    const storedName = `${createHash('sha256').update(normalizedUri).digest('hex').slice(0, 32)}${extension}`;
    await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(outputDirectory, storedName), matchingEntries[0].getData(), { mode: 0o600 });
    return storedName;
  };

  const updatedPosts: NormalizedPost[] = [];
  for (const post of posts) {
    if (!post.mediaUrls) {
      updatedPosts.push(post);
      continue;
    }
    const mediaUrls: string[] = [];
    for (const uri of post.mediaUrls) {
      if (!storedNames.has(uri)) storedNames.set(uri, await store(uri));
      mediaUrls.push(storedNames.get(uri) || uri);
    }
    updatedPosts.push({ ...post, mediaUrls });
  }
  return updatedPosts;
}
