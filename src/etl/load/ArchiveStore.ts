import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  NormalizedLike,
  NormalizedPost,
  NormalizedComment,
  Platform,
} from '../../types/schemas';

export type RelationshipClaimStatus =
  | 'pending_identity_match'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'rejected'
  | 'withdrawn';

export interface RelationshipClaim {
  claimId: string;
  relationshipKey: string;
  archiveId: string;
  platform: Platform;
  direction: 'source_follows_target' | 'target_follows_source';
  sourceAccount: {
    platformAccountId: string;
    handle?: string;
  };
  sourceIdentityMatch: {
    type: 'platform_account_id' | 'handle';
    value: string;
  };
  targetAccount: {
    platformAccountId: string;
    handle?: string;
  };
  targetIdentityMatch: {
    type: 'platform_account_id' | 'handle';
    value: string;
  };
  status: RelationshipClaimStatus;
  verified: false;
  evidence: {
    type: 'user_provided_archive';
    archiveId: string;
    importedAt: string;
    selectedAt: string;
  };
  confirmations: {
    source?: { mntlUserId: string; confirmedAt: string };
    target?: { mntlUserId: string; confirmedAt: string };
  };
  rejection?: {
    side: 'source' | 'target';
    mntlUserId: string;
    rejectedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface MatchedRelationshipClaim {
  claim: RelationshipClaim;
  matchedSides: Array<'source' | 'target'>;
}

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
  comments?: NormalizedComment[];
  selection?: ArchiveSelection;
  relationshipClaims?: RelationshipClaim[];
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
  sharedPostInteractions: Array<{
    postId: string;
    current: Array<{
      type: 'like' | 'comment';
      content?: string;
      postUrl?: string;
      occurredAt?: Date;
    }>;
    other: Array<{
      type: 'like' | 'comment';
      content?: string;
      postUrl?: string;
      occurredAt?: Date;
    }>;
  }>;
}

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, '').toLowerCase();
}

function normalizePostText(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeAccountHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').toLowerCase();
}

function normalizeAccountId(platform: Platform, accountId: string): string {
  return platform === 'x' ? accountId : normalizeAccountHandle(accountId);
}

function createRelationshipKey(
  platform: Platform,
  followerId: string,
  followingId: string
): string {
  return createHash('sha256')
    .update(`${platform}\u0000${normalizeAccountId(platform, followerId)}\u0000${normalizeAccountId(platform, followingId)}`)
    .digest('hex');
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

function interactionPostId(
  platform: Platform,
  postId: string,
  postUrl?: string
): string | null {
  if (platform === 'tiktok') {
    const videoId = `${postUrl || ''} ${postId}`.match(/\/video\/(\d+)/i)?.[1] ||
      postId.match(/^\d+$/)?.[0];
    if (videoId) return videoId;
  }
  return postId && postId !== 'unknown' ? postId : null;
}

function getPostInteractions(archive: StoredArchive): Map<
  string,
  Array<{
    type: 'like' | 'comment';
    content?: string;
    postUrl?: string;
    occurredAt?: Date;
  }>
> {
  const interactions = new Map<string, Array<{
    type: 'like' | 'comment';
    content?: string;
    postUrl?: string;
    occurredAt?: Date;
  }>>();
  const add = (
    postId: string,
    postUrl: string | undefined,
    interaction: {
      type: 'like' | 'comment';
      content?: string;
      postUrl?: string;
      occurredAt?: Date;
    }
  ) => {
    const targetId = interactionPostId(archive.platform, postId, postUrl);
    if (!targetId) return;
    const existing = interactions.get(targetId) || [];
    existing.push(interaction);
    interactions.set(targetId, existing);
  };

  for (const like of archive.likes) {
    add(like.postId, like.postUrl, {
      type: 'like',
      content: like.postText,
      postUrl: like.postUrl,
      occurredAt: like.likedAt,
    });
  }
  for (const comment of archive.comments || []) {
    add(comment.postId, comment.postUrl, {
      type: 'comment',
      content: comment.content,
      postUrl: comment.postUrl,
      occurredAt: comment.createdAt,
    });
  }
  return interactions;
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
  const currentInteractions = getPostInteractions(current);
  const otherInteractions = getPostInteractions(other);
  const sharedPostInteractions = [...currentInteractions.keys()]
    .filter(postId => otherInteractions.has(postId))
    .map(postId => ({
      postId,
      current: currentInteractions.get(postId)!,
      other: otherInteractions.get(postId)!,
    }));
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
    sharedPostInteractions,
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
  archive.comments = (archive.comments || []).map(comment => ({
    ...comment,
    createdAt: new Date(comment.createdAt),
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
      comments: archive.comments || [],
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
    const knownHandles = await this.getKnownOwnerHandles(archive.platform);
    const relationshipClaims = this.syncRelationshipClaims(
      archive,
      uniqueSelection,
      knownHandles,
      archive.relationshipClaims || []
    );
    const updated = { ...archive, selection: uniqueSelection, relationshipClaims };
    await this.save(updated);
    return updated;
  }

  async findRelationshipClaimsForIdentity(
    platform: Platform,
    identity: { platformAccountId?: string; handle?: string }
  ): Promise<MatchedRelationshipClaim[]> {
    const normalizedHandle = identity.handle ? normalizeAccountHandle(identity.handle) : undefined;
    const platformAccountId = identity.platformAccountId;
    if (!platformAccountId && !normalizedHandle) return [];

    const matchesIdentity = (
      match: RelationshipClaim['sourceIdentityMatch']
    ): boolean => {
      if (match.type === 'platform_account_id') {
        return Boolean(platformAccountId && match.value === platformAccountId);
      }
      const candidateHandle = normalizedHandle ||
        (platform !== 'x' && platformAccountId
          ? normalizeAccountHandle(platformAccountId)
          : undefined);
      return Boolean(candidateHandle && normalizeAccountHandle(match.value) === candidateHandle);
    };

    return (await this.list()).flatMap(archive =>
      (archive.relationshipClaims || []).flatMap(claim => {
        if (
          claim.platform !== platform ||
          (claim.status !== 'pending_identity_match' && claim.status !== 'awaiting_confirmation')
        ) {
          return [];
        }
        const matchedSides = [
          ...(matchesIdentity(claim.sourceIdentityMatch) ? ['source' as const] : []),
          ...(matchesIdentity(claim.targetIdentityMatch) ? ['target' as const] : []),
        ];
        return matchedSides.length ? [{ claim, matchedSides }] : [];
      })
    );
  }

  async confirmRelationshipClaim(
    archiveId: string,
    claimId: string,
    side: 'source' | 'target',
    mntlUserId: string
  ): Promise<RelationshipClaim> {
    const archive = await this.get(archiveId);
    if (!archive) throw new Error(`Stored archive not found: ${archiveId}`);
    const claims = archive.relationshipClaims || [];
    const claimIndex = claims.findIndex(claim => claim.claimId === claimId);
    if (claimIndex < 0) throw new Error(`Relationship claim not found: ${claimId}`);

    const claim = claims[claimIndex];
    if (claim.status === 'withdrawn' || claim.status === 'rejected') {
      throw new Error(`Cannot confirm a ${claim.status} relationship claim`);
    }
    const normalizedMntlUserId = mntlUserId.trim();
    if (!normalizedMntlUserId) throw new Error('MNTL user ID is required');

    const confirmations = {
      ...claim.confirmations,
      [side]: { mntlUserId: normalizedMntlUserId, confirmedAt: new Date().toISOString() },
    };
    if (
      confirmations.source &&
      confirmations.target &&
      confirmations.source.mntlUserId === confirmations.target.mntlUserId
    ) {
      throw new Error('Relationship claim must be confirmed by two different MNTL users');
    }

    const updatedClaim: RelationshipClaim = {
      ...claim,
      confirmations,
      status: confirmations.source && confirmations.target ? 'confirmed' : 'awaiting_confirmation',
      updatedAt: new Date().toISOString(),
    };
    claims[claimIndex] = updatedClaim;
    archive.relationshipClaims = claims;
    await this.save(archive);
    return updatedClaim;
  }

  async rejectRelationshipClaim(
    archiveId: string,
    claimId: string,
    side: 'source' | 'target',
    mntlUserId: string
  ): Promise<RelationshipClaim> {
    const archive = await this.get(archiveId);
    if (!archive) throw new Error(`Stored archive not found: ${archiveId}`);
    const claims = archive.relationshipClaims || [];
    const claimIndex = claims.findIndex(claim => claim.claimId === claimId);
    if (claimIndex < 0) throw new Error(`Relationship claim not found: ${claimId}`);
    const claim = claims[claimIndex];
    if (claim.status === 'withdrawn' || claim.status === 'confirmed' || claim.status === 'rejected') {
      throw new Error(`Cannot reject a ${claim.status} relationship claim`);
    }
    const normalizedMntlUserId = mntlUserId.trim();
    if (!normalizedMntlUserId) throw new Error('MNTL user ID is required');

    const updatedClaim: RelationshipClaim = {
      ...claim,
      status: 'rejected',
      rejection: { side, mntlUserId: normalizedMntlUserId, rejectedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    };
    claims[claimIndex] = updatedClaim;
    archive.relationshipClaims = claims;
    await this.save(archive);
    return updatedClaim;
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

  private syncRelationshipClaims(
    archive: StoredArchive,
    selection: ArchiveSelection,
    knownHandles: Map<string, string>,
    existingClaims: RelationshipClaim[]
  ): RelationshipClaim[] {
    const now = new Date().toISOString();
    const existingById = new Map(existingClaims.map(claim => [claim.claimId, claim]));
    const selectedClaims = new Map<string, RelationshipClaim>();
    const selectedRelationships = [
      ...selection.followers.map(accountId => ({
        accountId,
        direction: 'target_follows_source' as const,
      })),
      ...selection.following.map(accountId => ({
        accountId,
        direction: 'source_follows_target' as const,
      })),
    ];

    for (const { accountId, direction } of selectedRelationships) {
      const targetHandle = knownHandles.get(accountId) ||
        (archive.platform === 'instagram' || archive.platform === 'tiktok' ? accountId : undefined);
      const identityMatch = archive.platform === 'x'
        ? { type: 'platform_account_id' as const, value: accountId }
        : targetHandle
          ? { type: 'handle' as const, value: normalizeAccountHandle(targetHandle) }
          : { type: 'platform_account_id' as const, value: accountId };
      const followerId = direction === 'source_follows_target' ? archive.ownerId : accountId;
      const followingId = direction === 'source_follows_target' ? accountId : archive.ownerId;
      const relationshipKey = createRelationshipKey(archive.platform, followerId, followingId);
      const claimId = createHash('sha256')
        .update(`${archive.archiveId}\u0000${relationshipKey}`)
        .digest('hex');
      const existing = existingById.get(claimId);
      const isReactivated = existing?.status === 'withdrawn';
      const sourceIdentityMatch = archive.platform === 'x'
        ? { type: 'platform_account_id' as const, value: archive.ownerId }
        : archive.ownerHandle
          ? { type: 'handle' as const, value: normalizeAccountHandle(archive.ownerHandle) }
          : { type: 'platform_account_id' as const, value: archive.ownerId };
      const claim: RelationshipClaim = {
        claimId,
        relationshipKey,
        archiveId: archive.archiveId,
        platform: archive.platform,
        direction,
        sourceAccount: {
          platformAccountId: archive.ownerId,
          handle: archive.ownerHandle,
        },
        sourceIdentityMatch,
        targetAccount: {
          platformAccountId: accountId,
          handle: targetHandle,
        },
        targetIdentityMatch: identityMatch,
        status: isReactivated ? 'pending_identity_match' :
          existing?.status || 'pending_identity_match',
        verified: false,
        evidence: {
          type: 'user_provided_archive',
          archiveId: archive.archiveId,
          importedAt: archive.importedAt,
          selectedAt: isReactivated ? now : existing?.evidence.selectedAt || now,
        },
        confirmations: isReactivated ? {} : existing?.confirmations || {},
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      selectedClaims.set(claimId, claim);
    }

    for (const existing of existingClaims) {
      if (selectedClaims.has(existing.claimId)) continue;
      selectedClaims.set(existing.claimId, {
        ...existing,
        status: existing.status === 'confirmed' || existing.status === 'rejected'
          ? existing.status
          : 'withdrawn',
        updatedAt: now,
      });
    }

    return [...selectedClaims.values()];
  }
}
