import { createHmac, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { NormalizedComment, NormalizedLike, Platform } from '../../types/schemas';

// Third-party identities and post text are only stored as keyed fingerprints. The key
// is never stored with the data, so fingerprints of public handles cannot be reversed
// by hashing candidate handles. Losing the key breaks matching for existing data.
let fingerprintKey: Buffer | null = null;

function loadFingerprintKey(): Buffer {
  if (fingerprintKey) return fingerprintKey;
  if (process.env.FINGERPRINT_SECRET) {
    return fingerprintKey = Buffer.from(process.env.FINGERPRINT_SECRET);
  }

  if (process.env.NODE_ENV === 'production') {
    console.warn('FINGERPRINT_SECRET is not set; using a key file in the data directory');
  }
  const keyPath = path.join(process.cwd(), 'data', 'fingerprint.key');
  try {
    return fingerprintKey = fs.readFileSync(keyPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return fingerprintKey = fs.readFileSync(keyPath);
}

function fingerprint(...parts: string[]): string {
  return createHmac('sha256', loadFingerprintKey()).update(parts.join('\u0000')).digest('hex');
}

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').toLowerCase();
}

export function normalizeDisplayName(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export type IdentityType = 'platform_account_id' | 'handle' | 'display_name';

export function identityKey(type: IdentityType, platform: Platform, value: string): string {
  const normalized = type === 'display_name'
    ? normalizeDisplayName(value)
    : type === 'platform_account_id' && platform === 'x'
      ? value.trim()
      : normalizeHandle(value);
  return fingerprint('identity', type, platform, normalized);
}

// How follower and following list entries identify accounts on each platform.
export function relationshipIdentityType(platform: Platform): IdentityType {
  if (platform === 'x') return 'platform_account_id';
  if (platform === 'facebook') return 'display_name';
  return 'handle';
}

// Mutual relationships (Facebook friendships) get the same key from either side.
export function relationshipKey(platform: Platform, followerId: string, followingId: string, mutual = false): string {
  const type = relationshipIdentityType(platform);
  const keys = [identityKey(type, platform, followerId), identityKey(type, platform, followingId)];
  return fingerprint(mutual ? 'friendship' : 'relationship', ...(mutual ? keys.sort() : keys));
}

export function textKey(platform: Platform, text: string | undefined): string | undefined {
  const normalized = text ? normalizeDisplayName(text) : '';
  return normalized ? fingerprint('text', platform, normalized) : undefined;
}

export function accountKey(platform: Platform, accountId: string | undefined): string | undefined {
  return accountId?.trim() ? fingerprint('account', platform, normalizeHandle(accountId)) : undefined;
}

export function nameKey(platform: Platform, name: string | undefined): string | undefined {
  const normalized = name ? normalizeDisplayName(name) : '';
  return normalized ? fingerprint('name', platform, normalized) : undefined;
}

type OwnedContent = Pick<NormalizedLike, 'platform' | 'postOwnerId' | 'postOwnerName' | 'postOwnerIdKey' | 'postOwnerNameKey'>;

export function postOwnerKeys(item: OwnedContent): { idKey?: string; nameKey?: string } {
  return {
    idKey: item.postOwnerIdKey ?? accountKey(item.platform, item.postOwnerId),
    nameKey: item.postOwnerNameKey ?? nameKey(item.platform, item.postOwnerName),
  };
}

export function likeTextKey(like: Pick<NormalizedLike, 'platform' | 'postText' | 'postTextKey'>): string | undefined {
  return like.postTextKey ?? textKey(like.platform, like.postText);
}

// Replaces other people's post text and identities with fingerprints before storage.
export function minimizeLike({ postText, postOwnerId, postOwnerName, ...like }: NormalizedLike): NormalizedLike {
  const ownerKeys = postOwnerKeys({ platform: like.platform, postOwnerId, postOwnerName });
  return {
    ...like,
    postTextKey: likeTextKey({ platform: like.platform, postText, postTextKey: like.postTextKey }),
    postOwnerIdKey: like.postOwnerIdKey ?? ownerKeys.idKey,
    postOwnerNameKey: like.postOwnerNameKey ?? ownerKeys.nameKey,
  };
}

export function minimizeComment({ postOwnerId, postOwnerName, ...comment }: NormalizedComment): NormalizedComment {
  const ownerKeys = postOwnerKeys({ platform: comment.platform, postOwnerId, postOwnerName });
  return {
    ...comment,
    postOwnerIdKey: comment.postOwnerIdKey ?? ownerKeys.idKey,
    postOwnerNameKey: comment.postOwnerNameKey ?? ownerKeys.nameKey,
  };
}
