import * as fs from 'fs/promises';
import * as path from 'path';
import {
  NormalizedLike,
  NormalizedPost,
  Platform,
} from '../../types/schemas';

export interface StoredArchive {
  archiveId: string;
  ownerId: string;
  ownerHandle?: string;
  platform: Platform;
  importedAt: string;
  followers: string[];
  following: string[];
  posts: NormalizedPost[];
  likes: NormalizedLike[];
  selection?: ArchiveSelection;
}

export interface ArchiveSelection {
  postIds: string[];
  followers: string[];
  following: string[];
}

export interface ArchiveComparison {
  archiveId: string;
  ownerId: string;
  ownerHandle?: string;
  platform: Platform;
  follows: 'following' | 'follower' | 'mutual' | null;
  youFollowThem: boolean;
  theyFollowYou: boolean;
  sharedFollowing: string[];
  sharedFollowers: string[];
  likesOnTheirPosts: Array<{
    postId: string;
    postCaption?: string;
    mediaUrls?: string[];
    mediaTypes?: NormalizedPost['mediaTypes'];
    postType?: NormalizedPost['postType'];
    matchType: 'id' | 'shortcode' | 'text';
    likedAt?: Date;
  }>;
  theyLikeYourPosts: Array<{
    postId: string;
    postCaption?: string;
    mediaUrls?: string[];
    mediaTypes?: NormalizedPost['mediaTypes'];
    postType?: NormalizedPost['postType'];
    matchType: 'id' | 'shortcode' | 'text';
    likedAt?: Date;
  }>;
}

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, '').toLowerCase();
}

function normalizePostText(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function selectedRelationshipOrFallback(
  primaryAll: string[],
  primarySelected: string[],
  primaryName: string,
  fallbackAll: string[],
  fallbackSelected: string[],
  fallbackName: string
): boolean {
  const normalizedPrimaryName = normalizeUsername(primaryName);
  if (primaryAll.some(name => normalizeUsername(name) === normalizedPrimaryName)) {
    return primarySelected.some(name => normalizeUsername(name) === normalizedPrimaryName);
  }

  const normalizedFallbackName = normalizeUsername(fallbackName);
  return fallbackAll.some(name => normalizeUsername(name) === normalizedFallbackName) &&
    fallbackSelected.some(name => normalizeUsername(name) === normalizedFallbackName);
}

function findPostMatch(
  like: NormalizedLike,
  posts: NormalizedPost[]
): { post: NormalizedPost; matchType: 'id' | 'shortcode' | 'text' } | null {
  const byId = posts.find(post => post.originalPlatformId === like.postId);
  if (byId) return { post: byId, matchType: 'id' };

  if (like.postShortcode) {
    const byShortcode = posts.find(post => post.originalPlatformId === like.postShortcode);
    if (byShortcode) return { post: byShortcode, matchType: 'shortcode' };
  }

  if (!like.postText) return null;
  const text = normalizePostText(like.postText);
  if (!text) return null;

  const matches = posts.filter(post => post.content && normalizePostText(post.content) === text);
  return matches.length === 1 ? { post: matches[0], matchType: 'text' } : null;
}

export function compareArchives(
  current: StoredArchive,
  other: StoredArchive,
  currentSelection: ArchiveSelection = defaultSelection(current),
  otherSelection: ArchiveSelection = defaultSelection(other)
): ArchiveComparison {
  if (current.platform !== other.platform) {
    throw new Error('Cannot compare archives from different platforms');
  }

  const currentFollowsOther = selectedRelationshipOrFallback(
    current.following,
    currentSelection.following,
    other.ownerId,
    other.followers,
    otherSelection.followers,
    current.ownerId
  );
  const otherFollowsCurrent = selectedRelationshipOrFallback(
    current.followers,
    currentSelection.followers,
    other.ownerId,
    other.following,
    otherSelection.following,
    current.ownerId
  );
  const sharedFollowing = currentSelection.following.filter(name =>
    otherSelection.following.some(otherName => normalizeUsername(otherName) === normalizeUsername(name))
  );
  const sharedFollowers = currentSelection.followers.filter(name =>
    otherSelection.followers.some(otherName => normalizeUsername(otherName) === normalizeUsername(name))
  );
  const currentSelectedPosts = current.posts.filter(post =>
    currentSelection.postIds.includes(post.originalPlatformId)
  );
  const otherSelectedPosts = other.posts.filter(post =>
    otherSelection.postIds.includes(post.originalPlatformId)
  );

  const matchesFor = (likes: NormalizedLike[], posts: NormalizedPost[]) =>
    likes.flatMap(like => {
      const match = findPostMatch(like, posts);
      return match
        ? [{
            postId: match.post.originalPlatformId,
            postCaption: match.post.content,
            mediaUrls: match.post.mediaUrls,
            mediaTypes: match.post.mediaTypes,
            postType: match.post.postType,
            matchType: match.matchType,
            likedAt: like.likedAt,
          }]
        : [];
    });
  return {
    archiveId: other.archiveId,
    ownerId: other.ownerId,
    ownerHandle: other.ownerHandle?.trim().replace(/^@/, ''),
    platform: other.platform,
    youFollowThem: currentFollowsOther,
    theyFollowYou: otherFollowsCurrent,
    follows: currentFollowsOther && otherFollowsCurrent
      ? 'mutual'
      : currentFollowsOther
        ? 'following'
        : otherFollowsCurrent
          ? 'follower'
          : null,
    sharedFollowing,
    sharedFollowers,
    likesOnTheirPosts: matchesFor(current.likes, otherSelectedPosts),
    theyLikeYourPosts: otherFollowsCurrent ? matchesFor(other.likes, currentSelectedPosts) : [],
  };
}

function defaultSelection(archive: StoredArchive): ArchiveSelection {
  return {
    postIds: archive.posts.map(post => post.originalPlatformId),
    followers: archive.followers,
    following: archive.following,
  };
}

function hydrateArchiveDates(archive: StoredArchive): StoredArchive {
  archive.posts = archive.posts.map(post => ({
    ...post,
    createdAt: new Date(post.createdAt),
    updatedAt: post.updatedAt ? new Date(post.updatedAt) : undefined,
  }));
  archive.likes = archive.likes.map(like => ({
    ...like,
    likedAt: like.likedAt ? new Date(like.likedAt) : undefined,
  }));
  return archive;
}

function isSelection(value: unknown): value is ArchiveSelection {
  if (!value || typeof value !== 'object') return false;
  const selection = value as Record<string, unknown>;
  return ['postIds', 'followers', 'following'].every(
    key => Array.isArray(selection[key]) && (selection[key] as unknown[]).every(item => typeof item === 'string')
  );
}

export class ArchiveStore {
  constructor(
    private readonly directory = path.join(process.cwd(), 'data', 'archives')
  ) {}

  async save(archive: StoredArchive): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const filePath = this.filePath(archive.archiveId);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    const storedArchive = {
      ...archive,
      selection: isSelection(archive.selection) ? archive.selection : defaultSelection(archive),
    };
    await fs.writeFile(temporaryPath, JSON.stringify(storedArchive, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  }

  async get(archiveId: string): Promise<StoredArchive | null> {
    const filePath = this.filePath(archiveId);
    try {
      const archive = hydrateArchiveDates(JSON.parse(await fs.readFile(filePath, 'utf8')) as StoredArchive);
      if (!isSelection(archive.selection)) {
        archive.selection = defaultSelection(archive);
      }
      return archive;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async list(): Promise<StoredArchive[]> {
    let files: string[];
    try {
      files = await fs.readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const archives = await Promise.all(
      files.filter(file => file.endsWith('.json')).map(async file => {
        const content = await fs.readFile(path.join(this.directory, file), 'utf8');
        const archive = hydrateArchiveDates(JSON.parse(content) as StoredArchive);
        if (!isSelection(archive.selection)) {
          archive.selection = defaultSelection(archive);
        }
        return archive;
      })
    );
    return archives.sort((left, right) => right.importedAt.localeCompare(left.importedAt));
  }

  async getKnownOwnerHandles(platform: Platform): Promise<Map<string, string>> {
    const handles = new Map<string, string>();
    for (const archive of await this.list()) {
      const handle = archive.ownerHandle?.trim().replace(/^@/, '');
      if (archive.platform === platform && handle && !handles.has(archive.ownerId)) {
        handles.set(archive.ownerId, handle);
      }
    }
    return handles;
  }

  async saveSelection(archiveId: string, selection: ArchiveSelection): Promise<StoredArchive> {
    const archive = await this.get(archiveId);
    if (!archive) throw new Error(`Stored archive not found: ${archiveId}`);
    if (!isSelection(selection)) throw new Error('Invalid archive selection');
    const allowedPostIds = new Set(archive.posts.map(post => post.originalPlatformId));
    const allowedFollowers = new Set(archive.followers);
    const allowedFollowing = new Set(archive.following);
    if (
      selection.postIds.some(id => !allowedPostIds.has(id)) ||
      selection.followers.some(name => !allowedFollowers.has(name)) ||
      selection.following.some(name => !allowedFollowing.has(name))
    ) {
      throw new Error('Selection contains items not present in this archive');
    }

    const uniqueSelection = {
      postIds: [...new Set(selection.postIds)],
      followers: [...new Set(selection.followers)],
      following: [...new Set(selection.following)],
    };
    const updated = { ...archive, selection: uniqueSelection };
    await this.save(updated);
    return updated;
  }

  async compare(archiveId: string): Promise<ArchiveComparison[]> {
    const archives = await this.list();
    const current = archives.find(archive => archive.archiveId === archiveId);
    if (!current) throw new Error(`Stored archive not found: ${archiveId}`);

    const latestArchiveByOwner = new Map<string, StoredArchive>();
    for (const archive of archives) {
      const owner = normalizeUsername(archive.ownerId);
      if (
        archive.platform === current.platform &&
        owner !== normalizeUsername(current.ownerId) &&
        !latestArchiveByOwner.has(owner)
      ) {
        latestArchiveByOwner.set(owner, archive);
      }
    }

    return [...latestArchiveByOwner.values()].map(archive => compareArchives(
        current,
        archive,
        current.selection || defaultSelection(current),
        archive.selection || defaultSelection(archive)
      ));
  }

  private filePath(archiveId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(archiveId)) {
      throw new Error('Invalid archive identifier');
    }
    return path.join(this.directory, `${archiveId}.json`);
  }
}
