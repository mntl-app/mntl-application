import AdmZip from 'adm-zip';
import { createHash } from 'crypto';
import { BaseAdapter } from '../BaseAdapter';
import {
  NormalizedPost,
  NormalizedUser,
  NormalizedFollowRelation,
  NormalizedLike,
  NormalizedComment,
  Platform,
} from '../../types/schemas';

export class TikTokAdapter extends BaseAdapter {
  readonly platform: Platform = 'tiktok';

  detect(zipEntries: string[]): boolean {
    return zipEntries.some(entry => {
      const normalizedEntry = entry.toLowerCase();
      return normalizedEntry.includes('tiktok') ||
        normalizedEntry.includes('user_data') ||
        normalizedEntry.endsWith('/video_data.json');
    });
  }

  async extractPosts(zipPath: string): Promise<NormalizedPost[]> {
    const zip = new AdmZip(zipPath);

    try {
      const entries = zip.getEntries();
      const archiveEntry = entries.find(entry =>
        /(?:^|\/)user_data_tiktok\.json$/i.test(entry.entryName.replace(/\\/g, '/'))
      );
      if (archiveEntry) {
        const data = JSON.parse(archiveEntry.getData().toString('utf8'));
        return this.parsePublishedVideoList(data.Post?.Posts?.VideoList);
      }

      const legacyEntries = entries.filter(entry =>
        /(?:^|\/)video_data\.json$/i.test(entry.entryName.replace(/\\/g, '/')) ||
        /(?:^|\/)posts\.csv$/i.test(entry.entryName.replace(/\\/g, '/'))
      );
      return legacyEntries.flatMap(entry => {
        const content = entry.getData().toString('utf8');
        return entry.entryName.toLowerCase().endsWith('.json')
          ? this.parseVideoJSON(JSON.parse(content))
          : this.parseVideoCSV(content);
      });
    } catch (error) {
      console.error('Error extracting TikTok posts:', error);
      throw error;
    }
  }

  private parsePublishedVideoList(videoList: unknown): NormalizedPost[] {
    if (!Array.isArray(videoList)) return [];

    return videoList.flatMap((item: any) => {
      const link = this.firstString(item.Link, item.link, item.VideoUrl);
      const createdAt = this.parseTikTokDate(item.Date ?? item.create_time ?? item.createTime);
      if (!link || !createdAt) return [];

      const videoId = this.videoIdFromUrl(link);
      return [{
        originalPlatformId: videoId,
        platform: this.platform,
        postType: 'reel',
        content: this.firstString(item.description, item.Description, item.Title, item.title),
        mediaUrls: [link],
        mediaTypes: ['video'],
        createdAt,
        metrics: {
          likesCount: this.numberFromValue(item.Likes),
          commentsCount: 0,
          sharesCount: 0,
          viewsCount: 0,
        },
        location: typeof item.Location === 'string' && item.Location ? item.Location : undefined,
        isDeleted: false,
      }];
    });
  }

  private parseVideoJSON(data: any): NormalizedPost[] {
    const posts: NormalizedPost[] = [];

    try {
      const videoList = data.VideoList || data.videos || data;
      const items = Array.isArray(videoList) ? videoList : videoList.ItemList || [];

      for (const item of items) {
        const videoUrl = item.VideoUrl || item.Link;
        const createdAt = item.Date ? new Date(item.Date) : undefined;
        if (createdAt && !Number.isFinite(createdAt.getTime())) continue;
        const post: NormalizedPost = {
          originalPlatformId: String(item.VideoID || item.id || (videoUrl ? this.videoIdFromUrl(videoUrl) : '')),
          platform: this.platform,
          postType: 'reel',
          content: item.Description || item.Title || item.text || undefined,
          mediaUrls: videoUrl ? [videoUrl] : undefined,
          mediaTypes: videoUrl ? ['video'] : undefined,
          createdAt: createdAt || new Date(),
          metrics: {
            likesCount: this.numberFromValue(item.DiggCount ?? item.Likes),
            commentsCount: this.numberFromValue(item.CommentCount),
            sharesCount: this.numberFromValue(item.ShareCount),
            viewsCount: this.numberFromValue(item.PlayCount),
          },
          hashtags: item.Hashtags?.map((h: any) => h.HashtagName) || undefined,
          mentions: item.Mentions || undefined,
          location: item.Location || undefined,
          isDeleted: false,
        };
        posts.push(post);
      }
    } catch (error) {
      console.error('Error parsing TikTok video JSON:', error);
    }

    return posts;
  }

  private parseVideoCSV(content: string): NormalizedPost[] {
    const posts: NormalizedPost[] = [];
    const lines = content.split('\n').slice(1);

    for (const line of lines) {
      if (!line.trim()) continue;

      const [date, description, videoUrl, likes, comments, shares, views] = line.split(',').map(s => s?.trim());

      if (date) {
        const createdAt = new Date(date);
        if (!Number.isFinite(createdAt.getTime())) continue;
        posts.push({
          originalPlatformId: videoUrl ? this.videoIdFromUrl(videoUrl) : `tt_${createHash('sha256').update(line).digest('hex').slice(0, 20)}`,
          platform: this.platform,
          postType: 'reel',
          content: description || undefined,
          mediaUrls: videoUrl ? [videoUrl] : undefined,
          mediaTypes: videoUrl ? ['video'] : undefined,
          createdAt,
          metrics: {
            likesCount: this.numberFromValue(likes),
            commentsCount: this.numberFromValue(comments),
            sharesCount: this.numberFromValue(shares),
            viewsCount: this.numberFromValue(views),
          },
          hashtags: description ? this.extractHashtags(description) : undefined,
          mentions: description ? this.extractMentions(description) : undefined,
          isDeleted: false,
        });
      }
    }

    return posts;
  }

  async extractUsers(zipPath: string): Promise<NormalizedUser[]> {
    const zip = new AdmZip(zipPath);
    const users: NormalizedUser[] = [];

    try {
      const entries = zip.getEntries();
      const archiveEntry = entries.find(entry =>
        /(?:^|\/)user_data_tiktok\.json$/i.test(entry.entryName.replace(/\\/g, '/'))
      );
      if (archiveEntry) {
        const data = JSON.parse(archiveEntry.getData().toString('utf8'));
        const profile = data['Profile And Settings']?.['Profile Info']?.ProfileMap;
        const username = typeof profile?.userName === 'string' ? profile.userName : '';
        if (!username) return users;
        users.push({
          originalPlatformId: username,
          platform: this.platform,
          username,
          displayName: typeof profile.displayName === 'string' ? profile.displayName : undefined,
          bio: typeof profile.bioDescription === 'string' ? profile.bioDescription : undefined,
          profilePictureUrl: typeof profile.profilePhoto === 'string' ? profile.profilePhoto : undefined,
          followersCount: this.numberFromValue(profile.followerCount),
          followingCount: this.numberFromValue(profile.followingCount),
          postsCount: Array.isArray(data.Post?.Posts?.VideoList) ? data.Post.Posts.VideoList.length : 0,
          verified: false,
        });
        return users;
      }

      const profileFiles = entries.filter(entry =>
        entry.entryName.includes('user') && entry.entryName.endsWith('.json')
      );

      for (const entry of profileFiles) {
        const content = entry.getData().toString('utf8');
        const data = JSON.parse(content);

        const user: NormalizedUser = {
          originalPlatformId: data.UserID || data.id || `tt_user_${Date.now()}`,
          platform: this.platform,
          username: data.Username || data.ScreenName || 'unknown',
          displayName: data.NickName || data.DisplayName || undefined,
          bio: data.Bio || undefined,
          profilePictureUrl: data.AvatarUrl || undefined,
          followersCount: data.FollowersCount || 0,
          followingCount: data.FollowingCount || 0,
          postsCount: data.VideoCount || 0,
          verified: data.IsVerified || false,
          joinedAt: data.CreateTime ? new Date(data.CreateTime) : undefined,
        };
        users.push(user);
      }
    } catch (error) {
      console.error('Error extracting TikTok users:', error);
    }

    return users;
  }

  async extractFollowRelations(zipPath: string): Promise<NormalizedFollowRelation[]> {
    const zip = new AdmZip(zipPath);
    const relations: NormalizedFollowRelation[] = [];

    try {
      const entries = zip.getEntries();
      const archiveEntry = entries.find(entry =>
        /(?:^|\/)user_data_tiktok\.json$/i.test(entry.entryName.replace(/\\/g, '/'))
      );
      if (archiveEntry) {
        const data = JSON.parse(archiveEntry.getData().toString('utf8'));
        const following = data['Profile And Settings']?.Following?.Following;
        const followers = data['Profile And Settings']?.Follower?.FansList;
        for (const item of Array.isArray(following) ? following : []) {
          const username = typeof item.UserName === 'string' ? item.UserName.trim() : '';
          if (!username) continue;
          relations.push({
            followerId: 'me',
            followingId: username,
            platform: this.platform,
            followedAt: this.parseTikTokDate(item.Date),
          });
        }
        for (const item of Array.isArray(followers) ? followers : []) {
          const username = typeof item.UserName === 'string' ? item.UserName.trim() : '';
          if (!username) continue;
          relations.push({
            followerId: username,
            followingId: 'me',
            platform: this.platform,
            followedAt: this.parseTikTokDate(item.Date),
          });
        }
        return relations;
      }

      const followFiles = entries.filter(entry =>
        (entry.entryName.toLowerCase().includes('following') ||
          entry.entryName.toLowerCase().includes('follower')) &&
        (entry.entryName.endsWith('.json') || entry.entryName.endsWith('.csv'))
      );

      for (const entry of followFiles) {
        const content = entry.getData().toString('utf8');
        const isFollowingList = entry.entryName.toLowerCase().includes('following');

        if (entry.entryName.endsWith('.json')) {
          const data = JSON.parse(content);
          const followList = data.FollowingList || data.FollowerList || data;
          const items = Array.isArray(followList) ? followList : followList.ItemList || [];

          for (const item of items) {
            const username = item.UserName || item.Username || 'unknown';
            relations.push({
              followerId: isFollowingList ? 'me' : username,
              followingId: isFollowingList ? username : 'me',
              platform: this.platform,
              followedAt: item.FollowTime ? new Date(item.FollowTime) : undefined,
            });
          }
        } else if (entry.entryName.endsWith('.csv')) {
          const lines = content.split('\n').slice(1);
          for (const line of lines) {
            if (!line.trim()) continue;
            const [username, followTime] = line.split(',').map(s => s?.trim());
            if (username) {
              relations.push({
                followerId: isFollowingList ? 'me' : username,
                followingId: isFollowingList ? username : 'me',
                platform: this.platform,
                followedAt: followTime ? new Date(followTime) : undefined,
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Error extracting TikTok follow relations:', error);
    }

    return relations;
  }

  async extractLikes(_zipPath: string): Promise<NormalizedLike[]> {
    return [];
  }

  async extractComments(_zipPath: string): Promise<NormalizedComment[]> {
    return [];
  }

  private firstString(...values: unknown[]): string | undefined {
    return values.find((value): value is string =>
      typeof value === 'string' && Boolean(value.trim())
    )?.trim();
  }

  private videoIdFromUrl(value: string): string {
    try {
      const url = new URL(value);
      const sharedVideoId = url.pathname.match(/\/video\/(\d+)/i)?.[1];
      if (sharedVideoId) return sharedVideoId;
      const canonicalResource = `${url.hostname.toLowerCase()}${url.pathname}`;
      return `tt_${createHash('sha256').update(canonicalResource).digest('hex').slice(0, 24)}`;
    } catch {
      return `tt_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
    }
  }

  private parseTikTokDate(value: unknown): Date | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    if (typeof value === 'string' && !value.trim()) return undefined;
    const numeric = Number(value);
    const date = Number.isFinite(numeric) && /^\d{10,13}$/.test(String(value).trim())
      ? new Date(String(value).trim().length === 10 ? numeric * 1000 : numeric)
      : new Date(value);
    return Number.isFinite(date.getTime()) ? date : undefined;
  }

  private numberFromValue(value: unknown): number {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  private extractHashtags(text: string): string[] {
    const hashtagRegex = /#(\w+)/g;
    const hashtags: string[] = [];
    let match;
    while ((match = hashtagRegex.exec(text)) !== null) {
      hashtags.push(match[1]);
    }
    return hashtags;
  }

  private extractMentions(text: string): string[] {
    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }
    return mentions;
  }
}
