import AdmZip from 'adm-zip';
import { createHash } from 'crypto';
import * as path from 'path';
import { BaseAdapter } from '../BaseAdapter';
import { ZipExtractor } from '../../etl/extract/ZipExtractor';
import { NormalizedPost, NormalizedUser, NormalizedFollowRelation, NormalizedLike, NormalizedComment, Platform } from '../../types/schemas';

// Exports are localized, so labels are matched in the languages seen in archives.
const NAME_LABELS = new Set(['name', 'naam', 'nom', 'nombre', 'nome']);
const TITLE_LABELS = new Set(['title', 'titel', 'titre', 'título', 'titolo']);
const NON_PROFILE_PATHS = new Set([
  'events', 'fundraisers', 'gaming', 'groups', 'hashtag', 'help', 'login', 'marketplace', 'media',
  'notes', 'pages', 'photo', 'photo.php', 'photos', 'reel', 'reels', 'share', 'stories', 'watch',
]);
const VIDEO_URI_PATTERN = /\.(mp4|mov|webm)$/i;

type MediaItem = { uri?: unknown; creation_timestamp?: unknown; description?: unknown };

// Facebook writes UTF-8 text as Latin-1 escapes ("Letâ\u0080\u0099s"); this restores it.
function fixEncoding<T>(value: T): T {
  if (typeof value === 'string') {
    if (!/[\u0080-ÿ]/.test(value) || /[^\u0000-ÿ]/.test(value)) return value;
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    return (decoded.includes('�') ? value : decoded) as T;
  }
  if (Array.isArray(value)) return value.map(fixEncoding) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fixEncoding(item)])) as T;
  }
  return value;
}

function hashId(prefix: string, ...parts: unknown[]): string {
  return `${prefix}_${createHash('sha256').update(parts.map(String).join('\u0000')).digest('hex').slice(0, 24)}`;
}

function toDate(timestamp: unknown): Date | undefined {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// Post text marks tags as "@[100020187504237:2048:Reno Goelen]".
function parseMentions(text: string): { text: string; mentions: string[] } {
  const mentions: string[] = [];
  const cleaned = text.replace(/@\[\d+:\d+:([^\]]+)\]/g, (_match, name: string) => {
    mentions.push(name.trim());
    return `@${name.trim()}`;
  });
  return { text: cleaned, mentions };
}

// Finds the first label value in a (possibly nested) label_values list.
function findLabel(labelValues: unknown, labels: Set<string>): any {
  if (!Array.isArray(labelValues)) return undefined;
  for (const item of labelValues) {
    if (typeof item?.label === 'string' && labels.has(item.label.toLowerCase())) return item;
    const nested = findLabel(item?.dict, labels);
    if (nested) return nested;
  }
  return undefined;
}

export function facebookOwnerFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return undefined;
    const [first, second, third] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (!first) return undefined;
    if (['permalink.php', 'story.php', 'profile.php'].includes(first)) {
      return nonEmptyString(url.searchParams.get('id'));
    }
    if (first === 'people') return third || second;
    if (NON_PROFILE_PATHS.has(first.toLowerCase())) return undefined;
    return first;
  } catch {
    return undefined;
  }
}

// Reads the content owner from activity titles such as "Reno liked Jane Doe's post."
// or the Dutch "Sofie heeft gereageerd op het bericht van Jane Doe."
export function facebookOwnerFromTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const english = title.match(/\b(?:liked|reacted to|commented on|replied to) (.+)['’]s [^'’]+$/);
  const dutch = title.match(/\svan\s+(.+?)(?:\s+leuk)?\.?$/);
  return nonEmptyString(english?.[1] ?? dutch?.[1]);
}

export class FacebookAdapter extends BaseAdapter {
  readonly platform: Platform = 'facebook';

  detect(zipEntries: string[]): boolean {
    return zipEntries.some(entry => /(?:^|\/)your_facebook_activity\//i.test(entry.replace(/\\/g, '/')));
  }

  private entries(zipPath: string, pattern: RegExp): AdmZip.IZipEntry[] {
    return ZipExtractor.open(zipPath).getEntries().filter(entry => {
      const name = entry.entryName.replace(/\\/g, '/');
      return !entry.isDirectory &&
        !name.includes('__MACOSX/') &&
        !path.basename(name).startsWith('._') &&
        pattern.test(name);
    });
  }

  private readJson(entry: AdmZip.IZipEntry): any {
    return fixEncoding(JSON.parse(entry.getData().toString('utf8')));
  }

  private readLists(zipPath: string, pattern: RegExp): any[] {
    return this.entries(zipPath, pattern).flatMap(entry => {
      const data = this.readJson(entry);
      if (Array.isArray(data)) return data;
      return Object.values(data ?? {}).find(Array.isArray) ?? [];
    });
  }

  async extractPosts(zipPath: string): Promise<NormalizedPost[]> {
    const posts: NormalizedPost[] = [];
    const seenUris = new Set<string>();

    try {
      const postRecords = this.readLists(
        zipPath,
        /(?:^|\/)your_facebook_activity\/posts\/your_posts__check_ins__photos_and_videos(?:_\d+)?\.json$/i
      );
      for (const item of postRecords) {
        const createdAt = toDate(item.timestamp);
        if (!createdAt) continue;

        const attachments = (Array.isArray(item.attachments) ? item.attachments : [])
          .flatMap((attachment: any) => Array.isArray(attachment?.data) ? attachment.data : []);
        const mediaUris = attachments
          .map((data: any) => nonEmptyString(data?.media?.uri))
          .filter((uri: string | undefined): uri is string => Boolean(uri) && !uri!.includes('/stickers_used/'));
        const link = attachments.map((data: any) => nonEmptyString(data?.external_context?.url)).find(Boolean);
        const rawText = (Array.isArray(item.data) ? item.data : [])
          .map((data: any) => nonEmptyString(data?.post))
          .find(Boolean);
        if (!rawText && !mediaUris.length && !link) continue;

        const { text, mentions } = parseMentions(rawText || '');
        mediaUris.forEach((uri: string) => seenUris.add(uri));
        posts.push(this.createPost(
          hashId('fb', item.timestamp, mediaUris.join('\u0000'), rawText || link),
          createdAt,
          text || link,
          mediaUris,
          mentions
        ));
      }

      // Photos and videos that are not part of a post are imported as posts of their own.
      const standaloneMedia: MediaItem[] = [
        ...this.readLists(zipPath, /(?:^|\/)your_facebook_activity\/posts\/your_uncategorized_photos\.json$/i),
        ...this.readLists(zipPath, /(?:^|\/)your_facebook_activity\/posts\/your_videos\.json$/i),
        ...this.entries(zipPath, /(?:^|\/)your_facebook_activity\/posts\/album\/\d+\.json$/i)
          .flatMap(entry => this.readJson(entry)?.photos ?? []),
      ];
      for (const media of standaloneMedia) {
        const uri = nonEmptyString(media.uri);
        const createdAt = toDate(media.creation_timestamp);
        if (!uri || !createdAt || seenUris.has(uri) || uri.includes('/stickers_used/')) continue;
        seenUris.add(uri);
        const fileId = path.basename(uri).replace(/\.[^.]+$/, '');
        const { text, mentions } = parseMentions(nonEmptyString(media.description) || '');
        posts.push(this.createPost(
          /^\d+$/.test(fileId) ? fileId : hashId('fb', uri),
          createdAt,
          text,
          [uri],
          mentions
        ));
      }
    } catch (error) {
      console.error('Error extracting Facebook posts:', error);
    }

    return posts;
  }

  private createPost(
    originalPlatformId: string,
    createdAt: Date,
    content: string | undefined,
    mediaUris: string[],
    mentions: string[]
  ): NormalizedPost {
    const mediaTypes = mediaUris.map(uri => VIDEO_URI_PATTERN.test(uri) ? 'video' as const : 'image' as const);
    return {
      originalPlatformId,
      platform: this.platform,
      postType: mediaTypes.includes('video') ? 'reel' : mediaUris.length ? 'post' : 'text',
      content: content || undefined,
      mediaUrls: mediaUris.length ? mediaUris : undefined,
      mediaTypes: mediaUris.length ? mediaTypes : undefined,
      createdAt,
      metrics: { likesCount: 0, commentsCount: 0, sharesCount: 0, viewsCount: 0 },
      hashtags: content ? [...content.matchAll(/#(\w+)/g)].map(match => match[1]) : undefined,
      mentions: mentions.length ? mentions : undefined,
      isDeleted: false,
    };
  }

  async extractUsers(zipPath: string): Promise<NormalizedUser[]> {
    const users: NormalizedUser[] = [];

    try {
      const profileEntry = this.entries(
        zipPath,
        /(?:^|\/)personal_information\/profile_information\/profile_information\.json$/i
      )[0];
      const profile = profileEntry ? this.readJson(profileEntry)?.profile_v2 : undefined;
      if (!profile) return users;

      const fullName = nonEmptyString(profile.name?.full_name);
      const profileId = facebookOwnerFromUrl(profile.profile_uri);
      const accountId = nonEmptyString(profile.username) || profileId || fullName;
      if (!accountId) return users;

      users.push({
        originalPlatformId: accountId,
        platform: this.platform,
        username: accountId,
        displayName: fullName,
        bio: nonEmptyString(profile.intro_bio?.name ?? profile.intro_bio),
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        verified: false,
        joinedAt: toDate(profile.registration_timestamp),
      });
    } catch (error) {
      console.error('Error extracting Facebook users:', error);
    }

    return users;
  }

  // Exports only list display names, and have no followers list. Friendships are
  // mutual and kept apart from the profiles the account follows.
  async extractFollowRelations(zipPath: string): Promise<NormalizedFollowRelation[]> {
    const relations: NormalizedFollowRelation[] = [];

    try {
      const friends = this.readLists(zipPath, /(?:^|\/)connections\/friends\/your_friends\.json$/i);
      const following = this.readLists(zipPath, /(?:^|\/)connections\/followers\/who_you['’]ve_followed\.json$/i);
      const add = (name: unknown, timestamp: unknown, relationship: 'follow' | 'friend') => {
        const followingId = nonEmptyString(name);
        if (!followingId) return;
        relations.push({
          followerId: 'me',
          followingId,
          platform: this.platform,
          relationship,
          followedAt: toDate(timestamp),
        });
      };

      for (const friend of friends) add(friend?.name, friend?.timestamp, 'friend');
      for (const followed of following) add(followed?.name, followed?.timestamp, 'follow');
    } catch (error) {
      console.error('Error extracting Facebook follow relations:', error);
    }

    return relations;
  }

  // Facebook exports are often made for a limited date range (the default is
  // the last year), which silently drops older friendships, posts, and reactions.
  async describeLimitations(zipPath: string): Promise<string[]> {
    const [user] = await this.extractUsers(zipPath);
    const timestamps = [
      ...(await this.extractPosts(zipPath)).map(post => post.createdAt),
      ...(await this.extractLikes(zipPath)).map(like => like.likedAt),
      ...(await this.extractComments(zipPath)).map(comment => comment.createdAt),
      ...(await this.extractFollowRelations(zipPath)).map(relation => relation.followedAt),
    ].flatMap(date => date ? [date.getTime()] : []);
    if (!user?.joinedAt || !timestamps.length) return [];

    const oldest = Math.min(...timestamps);
    const newest = Math.max(...timestamps);
    const day = 24 * 60 * 60 * 1000;
    if (oldest - user.joinedAt.getTime() < 90 * day || newest - oldest > 400 * day) return [];
    return [
      `This Facebook export only contains data from ${new Date(oldest).toISOString().slice(0, 10)} onwards, ` +
      `but the account exists since ${user.joinedAt.toISOString().slice(0, 10)}. Older friendships, posts, and ` +
      `reactions are missing, so some connections cannot be found. Download your information again with ` +
      `the date range set to "All time".`,
    ];
  }

  async extractLikes(zipPath: string): Promise<NormalizedLike[]> {
    const likes: NormalizedLike[] = [];

    try {
      const records = [
        ...this.readLists(zipPath, /(?:^|\/)your_facebook_activity\/comments_and_reactions\/likes_and_reactions(?:_\d+)?\.json$/i),
        ...this.readLists(zipPath, /(?:^|\/)your_facebook_activity\/stories\/(?:older_)?story_reactions\.json$/i),
      ];
      const titledReactions: any[] = [];

      for (const item of records) {
        if (!Array.isArray(item?.label_values)) {
          if (Array.isArray(item?.data) && item.data.some((data: any) => data?.reaction)) titledReactions.push(item);
          continue;
        }
        const urlLabel = item.label_values.find((label: any) => label?.label === 'URL');
        const url = nonEmptyString(urlLabel?.href) || nonEmptyString(urlLabel?.value);
        const postId = nonEmptyString(item.fbid) ||
          url?.match(/(pfbid\w+)/)?.[1] ||
          url ||
          hashId('fb_reaction', item.timestamp, JSON.stringify(item.label_values));
        // For reactions to comments, the URL names the post owner but the name label
        // names the comment author, who owns the reacted-to content.
        const isCommentReaction = /[?&]comment_id=/.test(url || '');
        likes.push({
          userId: 'me',
          postId,
          platform: this.platform,
          likedAt: toDate(item.timestamp),
          postUrl: url,
          postText: nonEmptyString(findLabel(item.label_values, TITLE_LABELS)?.value),
          postOwnerId: isCommentReaction ? undefined : facebookOwnerFromUrl(url),
          postOwnerName: nonEmptyString(findLabel(item.label_values, NAME_LABELS)?.value),
        });
      }

      // Older reactions only describe the target in a title; skip those already listed above.
      for (const item of titledReactions) {
        const likedAt = toDate(item.timestamp);
        const postOwnerName = facebookOwnerFromTitle(item.title);
        const isDuplicate = likes.some(like =>
          like.likedAt && likedAt &&
          Math.abs(like.likedAt.getTime() - likedAt.getTime()) <= 5000 &&
          (!postOwnerName || like.postOwnerName === postOwnerName)
        );
        if (isDuplicate) continue;
        likes.push({
          userId: 'me',
          postId: hashId('fb_reaction', item.timestamp, item.title),
          platform: this.platform,
          likedAt,
          postOwnerName,
        });
      }
    } catch (error) {
      console.error('Error extracting Facebook likes:', error);
    }

    return likes;
  }

  async extractComments(zipPath: string): Promise<NormalizedComment[]> {
    const comments: NormalizedComment[] = [];

    try {
      const records = this.readLists(zipPath, /(?:^|\/)your_facebook_activity\/comments_and_reactions\/comments(?:_\d+)?\.json$/i);
      for (const item of records) {
        const comment = (Array.isArray(item?.data) ? item.data : []).find((data: any) => data?.comment)?.comment;
        const content = nonEmptyString(comment?.comment);
        const createdAt = toDate(comment?.timestamp ?? item.timestamp);
        if (!content || !createdAt) continue;

        comments.push({
          originalPlatformId: hashId('fb_comment', item.timestamp, content),
          platform: this.platform,
          postId: '',
          postOwnerName: facebookOwnerFromTitle(item.title),
          userId: nonEmptyString(comment.author) || 'me',
          content: parseMentions(content).text,
          createdAt,
          likesCount: 0,
        });
      }
    } catch (error) {
      console.error('Error extracting Facebook comments:', error);
    }

    return comments;
  }
}
