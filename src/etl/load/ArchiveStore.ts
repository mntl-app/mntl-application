import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  NormalizedLike,
  NormalizedPost,
  NormalizedComment,
  Platform,
} from '../../types/schemas';
import { normalizeMntlActivities } from './ActivityNormalizer';
import {
  identityKey,
  IdentityType,
  likeTextKey,
  normalizeHandle,
  relationshipIdentityType,
  relationshipKey as createRelationshipKey,
  textKey,
} from './Identity';
import { OptOutStore } from './OptOutStore';

// Unconfirmed selections keep their full relationship lists this long before the
// unselected accounts are deleted. Claims that are never confirmed expire after a year.
const SELECTION_WINDOW_DAYS = 30;
const PENDING_CLAIM_DAYS = 365;
const WITHDRAWN_CLAIM_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RelationshipClaimStatus =
  | 'pending_identity_match'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'rejected'
  | 'withdrawn';

// Identities are stored as keyed fingerprints (see Identity.ts), never as plain text.
// Facebook relationship lists only contain display names, so those claims match by name.
export interface IdentityMatch {
  type: IdentityType;
  value: string;
}

export interface RelationshipClaim {
  claimId: string;
  relationshipKey: string;
  archiveId: string;
  platform: Platform;
  direction: 'source_follows_target' | 'target_follows_source' | 'mutual_friends';
  sourceAccount: {
    platformAccountId: string;
    handle?: string;
  };
  sourceIdentityMatch: IdentityMatch;
  targetIdentityMatch: IdentityMatch;
  status: RelationshipClaimStatus;
  verified: boolean;
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
  ownerName?: string;
  mntlUserId?: string;
  mntlHandle?: string;
  platform: Platform;
  importedAt: string;
  importWarnings?: string[];
  followers: string[];
  following: string[];
  // Facebook only: friendships are mutual and distinct from following.
  friends?: string[];
  posts: NormalizedPost[];
  likes: NormalizedLike[];
  comments?: NormalizedComment[];
  selection?: ArchiveSelection;
  selectionConfirmedAt?: string;
  relationshipClaims?: RelationshipClaim[];
}

export interface ArchiveSelection {
  postIds: string[];
  followers: string[];
  following: string[];
  friends?: string[];
}

const RELATIONSHIP_LISTS = ['followers', 'following', 'friends'] as const;
type RelationshipList = typeof RELATIONSHIP_LISTS[number];

function relationshipList(source: StoredArchive | ArchiveSelection, list: RelationshipList): string[] {
  return source[list] || [];
}

// Applies a filter to every relationship list an archive and its selection have.
function filterRelationships(
  archive: StoredArchive,
  keep: (list: RelationshipList, accountId: string) => boolean
): StoredArchive {
  const selection = archive.selection || defaultSelection(archive);
  const updated: StoredArchive = { ...archive, selection: { ...selection } };
  for (const list of RELATIONSHIP_LISTS) {
    if (archive[list]) updated[list] = archive[list]!.filter(accountId => keep(list, accountId));
    if (selection[list]) updated.selection![list] = selection[list]!.filter(accountId => keep(list, accountId));
  }
  return updated;
}

export interface ArchiveComparison {
  archiveId: string;
  ownerId: string;
  ownerHandle?: string;
  mntlUserId?: string;
  mntlHandle?: string;
  platform: Platform;
  follows: 'following' | 'follower' | 'mutual' | null;
  youFollowThem: boolean;
  theyFollowYou: boolean;
  areFriends: boolean;
  sharedFollowingCount: number;
  sharedFollowersCount: number;
  sharedFriendsCount: number;
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

export interface MntlAccountMatch {
  mntlUserId: string;
  mntlHandle: string;
  accountHandle?: string;
}

export interface MntlConnection {
  mntlUserId: string;
  mntlHandle: string;
  platforms: Array<{
    platform: Platform;
    youFollowThem: boolean;
    theyFollowYou: boolean;
    friends?: boolean;
  }>;
}

function normalizeUsername(username: string): string {
  return normalizeHandle(username);
}

// The identifier other archives' follower and following lists use for this account.
function relationshipIdentifier(archive: StoredArchive): string {
  return archive.platform === 'facebook' && archive.ownerName ? archive.ownerName : archive.ownerId;
}

function normalizeAccountId(platform: Platform, accountId: string): string {
  return platform === 'x' ? accountId : normalizeHandle(accountId);
}

function relationshipEntryKey(platform: Platform, accountId: string): string {
  return identityKey(relationshipIdentityType(platform), platform, accountId);
}

// The identifiers by which other archives may refer to this archive's owner.
function ownerIdentityValue(type: IdentityType, archive: StoredArchive): string | undefined {
  if (type === 'display_name') return archive.ownerName;
  if (type === 'platform_account_id') return archive.ownerId;
  return archive.ownerHandle ||
    (archive.platform === 'instagram' || archive.platform === 'tiktok' ? archive.ownerId : undefined);
}

function ownerIdentityMatch(archive: StoredArchive): IdentityMatch {
  const preferredType = relationshipIdentityType(archive.platform);
  const type = ownerIdentityValue(preferredType, archive) ? preferredType : 'platform_account_id';
  return { type, value: identityKey(type, archive.platform, ownerIdentityValue(type, archive)!) };
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

  const likedTextKey = likeTextKey(like);
  if (!likedTextKey) return null;

  const matches = posts.filter(post => textKey(post.platform, post.content) === likedTextKey);
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
    relationshipIdentifier(other),
    other.followers,
    otherSelection.followers,
    relationshipIdentifier(current)
  );
  const otherFollowsCurrent = selectedRelationshipOrFallback(
    current.followers,
    currentSelection.followers,
    relationshipIdentifier(other),
    other.following,
    otherSelection.following,
    relationshipIdentifier(current)
  );
  // Only counts are shared: the accounts themselves are mostly people outside MNTL.
  const countShared = (currentAccounts: string[], otherAccounts: string[]) => {
    const otherKeys = new Set(otherAccounts.map(accountId => relationshipEntryKey(other.platform, accountId)));
    return currentAccounts.filter(accountId => otherKeys.has(relationshipEntryKey(other.platform, accountId))).length;
  };
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
      // The other user's comment text is theirs to share, not part of this comparison.
      other: otherInteractions.get(postId)!.map(({ content: _content, ...interaction }) => interaction),
    }));
  return {
    archiveId: other.archiveId,
    ownerId: other.ownerId,
    ownerHandle: other.ownerHandle?.trim().replace(/^@/, ''),
    mntlUserId: other.mntlUserId,
    mntlHandle: other.mntlHandle,
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
    areFriends: selectedRelationshipOrFallback(
      relationshipList(current, 'friends'),
      relationshipList(currentSelection, 'friends'),
      relationshipIdentifier(other),
      relationshipList(other, 'friends'),
      relationshipList(otherSelection, 'friends'),
      relationshipIdentifier(current)
    ),
    sharedFollowingCount: countShared(currentSelection.following, otherSelection.following),
    sharedFollowersCount: countShared(currentSelection.followers, otherSelection.followers),
    sharedFriendsCount: countShared(relationshipList(currentSelection, 'friends'), relationshipList(otherSelection, 'friends')),
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
    ...(archive.friends ? { friends: archive.friends } : {}),
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
  const isStringList = (key: string) =>
    Array.isArray(selection[key]) && (selection[key] as unknown[]).every(item => typeof item === 'string');
  return ['postIds', 'followers', 'following'].every(isStringList) &&
    (selection.friends === undefined || isStringList('friends'));
}

export class ArchiveStore {
  constructor(
    private readonly directory = path.join(process.cwd(), 'data', 'archives'),
    private readonly optOuts = new OptOutStore()
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

  // Finds which accounts in a follower, following, or friends list belong to MNTL users,
  // matched the same way as relationship claims. Ambiguous matches are left out.
  async findMntlAccounts(
    platform: Platform,
    accountIds: string[],
    excludeMntlUserId?: string
  ): Promise<Map<string, MntlAccountMatch>> {
    const type = relationshipIdentityType(platform);
    const candidatesByKey = new Map<string, Map<string, MntlAccountMatch>>();
    for (const archive of await this.list()) {
      const ownerValue = ownerIdentityValue(type, archive);
      if (archive.platform !== platform || !archive.mntlUserId || !archive.mntlHandle || !ownerValue) continue;
      if (archive.mntlUserId === excludeMntlUserId) continue;
      const key = identityKey(type, platform, ownerValue);
      const candidates = candidatesByKey.get(key) || new Map<string, MntlAccountMatch>();
      if (!candidates.has(archive.mntlUserId)) {
        candidates.set(archive.mntlUserId, {
          mntlUserId: archive.mntlUserId,
          mntlHandle: archive.mntlHandle,
          accountHandle: archive.ownerHandle?.trim().replace(/^@/, ''),
        });
      }
      candidatesByKey.set(key, candidates);
    }

    const matches = new Map<string, MntlAccountMatch>();
    for (const accountId of accountIds) {
      const candidates = candidatesByKey.get(relationshipEntryKey(platform, accountId));
      if (candidates?.size === 1) matches.set(accountId, [...candidates.values()][0]);
    }
    return matches;
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
    if (
      selection.postIds.some(id => !allowedPostIds.has(id)) ||
      RELATIONSHIP_LISTS.some(list => {
        const allowed = new Set(relationshipList(archive, list));
        return relationshipList(selection, list).some(accountId => !allowed.has(accountId));
      })
    ) {
      throw new Error('Selection contains items not present in this archive');
    }

    const uniqueSelection: ArchiveSelection = {
      postIds: [...new Set(selection.postIds)],
      followers: [...new Set(selection.followers)],
      following: [...new Set(selection.following)],
      ...(archive.friends ? { friends: [...new Set(relationshipList(selection, 'friends'))] } : {}),
    };
    const relationshipClaims = this.syncRelationshipClaims(
      archive,
      uniqueSelection,
      await this.optOuts.keys(),
      archive.relationshipClaims || []
    );
    const updated = { ...archive, selection: uniqueSelection, relationshipClaims };
    await this.save(updated);
    return updated;
  }

  // Called when the user confirms their selection: unselected followers, following, and
  // friends are deleted, since they are mostly people who never chose to be part of MNTL.
  async confirmSelection(archiveId: string): Promise<StoredArchive> {
    const archive = await this.get(archiveId);
    if (!archive) throw new Error(`Stored archive not found: ${archiveId}`);
    const updated = {
      ...this.withoutUnselectedRelationships(archive),
      selectionConfirmedAt: new Date().toISOString(),
    };
    await this.save(updated);
    return updated;
  }

  async optOut(platform: Platform, account: string): Promise<void> {
    await this.optOuts.add(platform, account);
    await this.applyRetention();
  }

  // Deletes unselected relationships once the selection window has passed, expires
  // claims that were never confirmed, and removes everyone who opted out.
  async applyRetention(now = new Date()): Promise<number> {
    const optOutKeys = await this.optOuts.keys();
    let updatedCount = 0;

    for (const archive of await this.list()) {
      let updated = archive;
      const selectionExpired = now.getTime() - Date.parse(archive.importedAt) > SELECTION_WINDOW_DAYS * DAY_MS;
      if (!archive.selectionConfirmedAt && selectionExpired) {
        updated = this.withoutUnselectedRelationships(updated);
      }

      updated = filterRelationships(updated, (_list, accountId) =>
        !optOutKeys.has(relationshipEntryKey(archive.platform, accountId))
      );
      updated = {
        ...updated,
        relationshipClaims: (updated.relationshipClaims || []).filter(claim => {
          if (optOutKeys.has(claim.targetIdentityMatch.value)) return false;
          const age = now.getTime() - Date.parse(claim.status === 'withdrawn' ? claim.updatedAt : claim.createdAt);
          if (claim.status === 'withdrawn') return age <= WITHDRAWN_CLAIM_DAYS * DAY_MS;
          if (claim.status === 'pending_identity_match' || claim.status === 'awaiting_confirmation') {
            return age <= PENDING_CLAIM_DAYS * DAY_MS;
          }
          return true;
        }),
      };

      if (JSON.stringify(updated) !== JSON.stringify(archive)) {
        await this.save(updated);
        updatedCount++;
      }
    }
    return updatedCount;
  }

  private withoutUnselectedRelationships(archive: StoredArchive): StoredArchive {
    const selection = archive.selection || defaultSelection(archive);
    const selected = Object.fromEntries(RELATIONSHIP_LISTS.map(list =>
      [list, new Set(relationshipList(selection, list))]
    )) as Record<RelationshipList, Set<string>>;
    return filterRelationships(archive, (list, accountId) => selected[list].has(accountId));
  }

  async findRelationshipClaimsForIdentity(
    platform: Platform,
    identity: { platformAccountId?: string; handle?: string; displayName?: string }
  ): Promise<MatchedRelationshipClaim[]> {
    const identityKeys = new Set([
      ...(identity.platformAccountId
        ? [
            identityKey('platform_account_id', platform, identity.platformAccountId),
            ...(platform !== 'x' ? [identityKey('handle', platform, identity.platformAccountId)] : []),
          ]
        : []),
      ...(identity.handle ? [identityKey('handle', platform, identity.handle)] : []),
      ...(identity.displayName ? [identityKey('display_name', platform, identity.displayName)] : []),
    ]);
    if (!identityKeys.size) return [];
    const matchesIdentity = (match: IdentityMatch) => identityKeys.has(match.value);

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

  async compare(archiveId: string): Promise<ArchiveComparison[]> {
    const archives = await this.list();
    const current = archives.find(archive => archive.archiveId === archiveId);
    if (!current) throw new Error(`Stored archive not found: ${archiveId}`);

    const latestArchiveByOwner = new Map<string, StoredArchive>();
    for (const archive of archives) {
      const owner = normalizeUsername(archive.ownerId);
      if (
        archive.platform === current.platform &&
        (current.mntlUserId
          ? archive.mntlUserId && archive.mntlUserId !== current.mntlUserId
          : owner !== normalizeUsername(current.ownerId)) &&
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

  async getMntlConnections(mntlUserId: string): Promise<MntlConnection[]> {
    const archives = await this.list();
    const latestArchiveByAccount = new Map<string, StoredArchive>();
    for (const archive of archives) {
      if (!archive.mntlUserId) continue;
      const key = `${archive.mntlUserId}\u0000${archive.platform}\u0000${normalizeAccountId(archive.platform, archive.ownerId)}`;
      if (!latestArchiveByAccount.has(key)) latestArchiveByAccount.set(key, archive);
    }

    const accountArchives = [...latestArchiveByAccount.values()];
    const connections = new Map<string, MntlConnection>();

    for (const sourceArchive of accountArchives) {
      if (!sourceArchive.mntlUserId || !sourceArchive.mntlHandle) continue;
      for (const claim of sourceArchive.relationshipClaims || []) {
        if (
          (claim.status !== 'awaiting_confirmation' && claim.status !== 'confirmed') ||
          claim.confirmations.source?.mntlUserId !== sourceArchive.mntlUserId
        ) continue;
        const matchingTargetUsers = this.matchingTargetUserIds(archives, claim);
        if (matchingTargetUsers.length !== 1) continue;
        const targetArchive = accountArchives.find(candidate =>
          candidate.platform === claim.platform &&
          candidate.mntlUserId === matchingTargetUsers[0] &&
          candidate.mntlUserId !== sourceArchive.mntlUserId &&
          this.identityMatchesArchive(claim.targetIdentityMatch, candidate)
        );
        if (!targetArchive?.mntlUserId || !targetArchive.mntlHandle) continue;

        let currentUserFollows = false;
        let otherUserFollows = false;
        if (claim.direction === 'mutual_friends') {
          // Friendship is mutual, so it does not imply following either way.
        } else if (claim.direction === 'source_follows_target') {
          currentUserFollows = sourceArchive.mntlUserId === mntlUserId;
          otherUserFollows = targetArchive.mntlUserId === mntlUserId;
        } else {
          otherUserFollows = sourceArchive.mntlUserId === mntlUserId;
          currentUserFollows = targetArchive.mntlUserId === mntlUserId;
        }
        if (sourceArchive.mntlUserId !== mntlUserId && targetArchive.mntlUserId !== mntlUserId) {
          continue;
        }

        const otherUserId = sourceArchive.mntlUserId === mntlUserId
          ? targetArchive.mntlUserId
          : sourceArchive.mntlUserId;
        const otherHandle = sourceArchive.mntlUserId === mntlUserId
          ? targetArchive.mntlHandle
          : sourceArchive.mntlHandle;
        let connection = connections.get(otherUserId);
        if (!connection) {
          connection = { mntlUserId: otherUserId, mntlHandle: otherHandle, platforms: [] };
          connections.set(otherUserId, connection);
        }
        let platformMatch = connection.platforms.find(match => match.platform === claim.platform);
        if (!platformMatch) {
          platformMatch = {
            platform: claim.platform,
            youFollowThem: false,
            theyFollowYou: false,
            ...(claim.platform === 'facebook' ? { friends: false } : {}),
          };
          connection.platforms.push(platformMatch);
        }
        platformMatch.youFollowThem ||= currentUserFollows;
        platformMatch.theyFollowYou ||= otherUserFollows;
        if (claim.direction === 'mutual_friends') platformMatch.friends = true;
      }
    }

    return [...connections.values()]
      .map(connection => ({
        ...connection,
        platforms: connection.platforms.sort((left, right) =>
          left.platform.localeCompare(right.platform)
        ),
      }))
      .sort((left, right) => left.mntlHandle.localeCompare(right.mntlHandle));
  }

  async getMntlActivities(mntlUserId: string) {
    const archives = await this.list();
    const mntlArchives = archives.filter(
      (archive): archive is StoredArchive & { mntlUserId: string; mntlHandle: string } =>
        Boolean(archive.mntlUserId && archive.mntlHandle)
    );
    // Other users' posts are only shown if they selected them for migration.
    const posts = mntlArchives.flatMap(archive => {
      const visiblePostIds = archive.mntlUserId === mntlUserId
        ? null
        : new Set((archive.selection || defaultSelection(archive)).postIds);
      return archive.posts
        .filter(post => !visiblePostIds || visiblePostIds.has(post.originalPlatformId))
        .map(post => ({ archive, post }));
    });
    return normalizeMntlActivities(
      mntlArchives.filter(archive => archive.mntlUserId === mntlUserId),
      posts,
      mntlArchives
    );
  }

  private identityMatchesArchive(identity: IdentityMatch, archive: StoredArchive): boolean {
    const value = ownerIdentityValue(identity.type, archive);
    return Boolean(value && identityKey(identity.type, archive.platform, value) === identity.value);
  }

  private matchingTargetUserIds(
    archives: StoredArchive[],
    claim: RelationshipClaim
  ): string[] {
    return [...new Set(archives.flatMap(archive =>
      archive.mntlUserId &&
      archive.platform === claim.platform &&
      this.identityMatchesArchive(claim.targetIdentityMatch, archive)
        ? [archive.mntlUserId]
        : []
    ))];
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
    optOutKeys: Set<string>,
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
      ...relationshipList(selection, 'friends').map(accountId => ({
        accountId,
        direction: 'mutual_friends' as const,
      })),
    ];

    for (const { accountId, direction } of selectedRelationships) {
      const identityMatch: IdentityMatch = {
        type: relationshipIdentityType(archive.platform),
        value: relationshipEntryKey(archive.platform, accountId),
      };
      if (optOutKeys.has(identityMatch.value)) continue;
      const owner = relationshipIdentifier(archive);
      const [followerId, followingId] = direction === 'target_follows_source' ? [accountId, owner] : [owner, accountId];
      const relationshipKey = createRelationshipKey(
        archive.platform,
        followerId,
        followingId,
        direction === 'mutual_friends'
      );
      const claimId = createHash('sha256')
        .update(`${archive.archiveId}\u0000${relationshipKey}`)
        .digest('hex');
      const existing = existingById.get(claimId);
      const isReactivated = existing?.status === 'withdrawn';
      const sourceIdentityMatch = ownerIdentityMatch(archive);
      const confirmations: RelationshipClaim['confirmations'] = isReactivated
        ? {}
        : { ...(existing?.confirmations || {}) };
      if (archive.mntlUserId && (!confirmations.source ||
        confirmations.source.mntlUserId !== archive.mntlUserId)) {
        confirmations.source = {
          mntlUserId: archive.mntlUserId,
          confirmedAt: now,
        };
      }
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
        targetIdentityMatch: identityMatch,
        status: isReactivated
          ? 'pending_identity_match'
          : existing?.status === 'confirmed' || existing?.status === 'rejected'
            ? existing.status
            : archive.mntlUserId
              ? 'awaiting_confirmation'
              : existing?.status || 'pending_identity_match',
        verified: existing?.verified || false,
        evidence: {
          type: 'user_provided_archive',
          archiveId: archive.archiveId,
          importedAt: archive.importedAt,
          selectedAt: isReactivated ? now : existing?.evidence.selectedAt || now,
        },
        confirmations,
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
