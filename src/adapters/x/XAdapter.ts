import AdmZip from 'adm-zip';
import * as path from 'path';
import { BaseAdapter } from '../BaseAdapter';
import { NormalizedPost, NormalizedUser, NormalizedFollowRelation, NormalizedLike, NormalizedComment, Platform } from '../../types/schemas';

export class XAdapter extends BaseAdapter {
  readonly platform: Platform = 'x';

  detect(zipEntries: string[]): boolean {
    return zipEntries.some(entry => {
      const normalizedEntry = entry.toLowerCase();
      return normalizedEntry.includes('twitter') ||
        normalizedEntry === 'tweets.js' ||
        normalizedEntry.endsWith('/tweets.js') ||
        normalizedEntry.includes('/data/tweets');
    });
  }

  async extractPosts(zipPath: string): Promise<NormalizedPost[]> {
    const zip = new AdmZip(zipPath);
    const posts: NormalizedPost[] = [];

    try {
      const entries = zip.getEntries();
      const tweetFiles = entries.filter(entry =>
        /(?:^|\/)data\/tweets(?:_\d+)?\.js$/i.test(entry.entryName.replace(/\\/g, '/'))
      );

      for (const entry of tweetFiles) {
        const content = entry.getData().toString('utf8');
        const jsonContent = this.stripJsWrapper(content);
        const data = JSON.parse(jsonContent);

        const extractedPosts = this.parseTweets(data, entries);
        posts.push(...extractedPosts);
      }
    } catch (error) {
      console.error('Error extracting X posts:', error);
    }

    return posts;
  }

  private stripJsWrapper(content: string): string {
    const assignmentIndex = content.indexOf('=');
    const payload = assignmentIndex === -1 ? content : content.slice(assignmentIndex + 1);
    return payload.trim().replace(/;\s*$/, '');
  }

  private parseTweets(data: any, entries: AdmZip.IZipEntry[]): NormalizedPost[] {
    const posts: NormalizedPost[] = [];

    try {
      const tweetList = Array.isArray(data) ? data : [];
      const items = tweetList.flatMap((item: any) => item.tweet || item);
      const mediaEntries = entries.filter(entry => {
        const name = entry.entryName.replace(/\\/g, '/');
        return !entry.isDirectory &&
          /(?:^|\/)data\/tweets_media\//i.test(name) &&
          !name.includes('/__MACOSX/') &&
          !name.split('/').pop()?.startsWith('._');
      });

      for (const item of items) {
        const postId = String(item.id_str || item.id || '');
        const createdAt = item.created_at ? new Date(item.created_at) : undefined;
        if (!postId || !createdAt || !Number.isFinite(createdAt.getTime())) continue;

        const media = item.extended_entities?.media || item.entities?.media || [];
        const tweetMediaEntries = mediaEntries.filter(entry => {
          const fileName = path.basename(entry.entryName.replace(/\\/g, '/'));
          return fileName.startsWith(`${postId}-`) || fileName.startsWith(`${postId}.`);
        });
        const mediaUrls = media.map((itemMedia: any, index: number) => {
          const remoteFileName = path.basename(
            String(itemMedia.media_url_https || itemMedia.media_url || '')
          );
          const matchingEntry = tweetMediaEntries.find(entry =>
            path.basename(entry.entryName.replace(/\\/g, '/')).endsWith(remoteFileName)
          ) || tweetMediaEntries[index];
          return matchingEntry?.entryName.replace(/\\/g, '/') ||
            itemMedia.media_url_https ||
            itemMedia.media_url;
        }).filter((uri: unknown): uri is string => typeof uri === 'string' && uri.length > 0);
        const mediaTypes = media.map((itemMedia: any, index: number) => {
          const mediaUrl = mediaUrls[index] || '';
          return itemMedia.type === 'video' ||
            itemMedia.type === 'animated_gif' ||
            /\.(mp4|mov|webm)(?:$|\?)/i.test(mediaUrl)
            ? 'video' as const
            : 'image' as const;
        });
        const hasVideo = mediaTypes.includes('video');
        const content = item.full_text || item.text || undefined;
        const replyToPostId = item.in_reply_to_status_id_str || item.in_reply_to_status_id;
        const isReply = replyToPostId !== undefined && replyToPostId !== null && String(replyToPostId).length > 0;
        const post: NormalizedPost = {
          originalPlatformId: postId,
          platform: this.platform,
          postType: hasVideo ? 'reel' : mediaUrls.length ? 'post' : 'text',
          isReply: isReply || undefined,
          replyToPostId: isReply ? String(replyToPostId) : undefined,
          content,
          mediaUrls: mediaUrls.length ? mediaUrls : undefined,
          mediaTypes: mediaUrls.length ? mediaTypes : undefined,
          createdAt,
          metrics: {
            likesCount: Number(item.favorite_count) || 0,
            commentsCount: Number(item.reply_count) || 0,
            sharesCount: Number(item.retweet_count) || 0,
            viewsCount: Number(item.view_count) || 0,
          },
          hashtags: item.entities?.hashtags?.map((h: any) => h.text) || undefined,
          mentions: item.entities?.user_mentions?.map((u: any) => u.screen_name) || undefined,
          location: item.place?.full_name || item.geo?.coordinates?.join(',') || undefined,
          isDeleted: false,
        };
        posts.push(post);
      }
    } catch (error) {
      console.error('Error parsing X tweets:', error);
    }

    return posts;
  }

  async extractUsers(zipPath: string): Promise<NormalizedUser[]> {
    const zip = new AdmZip(zipPath);
    const users: NormalizedUser[] = [];

    try {
      const entries = zip.getEntries();
      const accountFiles = entries.filter(entry =>
        /(?:^|\/)data\/account\.js$/i.test(entry.entryName.replace(/\\/g, '/'))
      );

      for (const entry of accountFiles) {
        const content = entry.getData().toString('utf8');
        const jsonContent = this.stripJsWrapper(content);
        const data = JSON.parse(jsonContent);

        const account = data[0]?.account;
        if (!account) continue;
        const accountId = String(account.accountId || account.id_str || account.id || '');
        if (!accountId) continue;
        const user: NormalizedUser = {
          originalPlatformId: accountId,
          platform: this.platform,
          username: account.username || accountId,
          displayName: account.accountDisplayName || account.name || undefined,
          bio: account.description || undefined,
          profilePictureUrl: account.profileImageUrl || account.profile_image_url_https || undefined,
          followersCount: Number(account.followers_count) || 0,
          followingCount: Number(account.friends_count) || 0,
          postsCount: Number(account.statuses_count) || 0,
          verified: Boolean(account.verified),
          joinedAt: account.createdAt || account.created_at
            ? new Date(account.createdAt || account.created_at)
            : undefined,
        };
        users.push(user);
      }
    } catch (error) {
      console.error('Error extracting X users:', error);
    }

    return users;
  }

  async extractFollowRelations(zipPath: string): Promise<NormalizedFollowRelation[]> {
    const zip = new AdmZip(zipPath);
    const relations: NormalizedFollowRelation[] = [];

    try {
      const entries = zip.getEntries();
      const followFiles = entries.filter(entry =>
        /(?:^|\/)data\/(?:following|follower)(?:_\d+)?\.js$/i.test(entry.entryName.replace(/\\/g, '/'))
      );

      for (const entry of followFiles) {
        const content = entry.getData().toString('utf8');
        const jsonContent = this.stripJsWrapper(content);
        const data = JSON.parse(jsonContent);
        const isFollowingList = /(?:^|\/)data\/following(?:_\d+)?\.js$/i.test(entry.entryName.replace(/\\/g, '/'));

        const followList = Array.isArray(data) ? data : [];
        const items = followList.flatMap((item: any) => item.following || item.follower || item);

        for (const item of items) {
          const accountId = String(item.accountId || item.account_id || item.username || '');
          if (!accountId) continue;
          relations.push({
            followerId: isFollowingList ? 'me' : accountId,
            followingId: isFollowingList ? accountId : 'me',
            platform: this.platform,
            followedAt: undefined,
          });
        }
      }
    } catch (error) {
      console.error('Error extracting X follow relations:', error);
    }

    return relations;
  }

  async extractLikes(zipPath: string): Promise<NormalizedLike[]> {
    const zip = new AdmZip(zipPath);
    const likes: NormalizedLike[] = [];

    try {
      const entries = zip.getEntries();
      const likeFiles = entries.filter(entry =>
        /(?:^|\/)data\/like(?:_\d+)?\.js$/i.test(entry.entryName.replace(/\\/g, '/'))
      );

      for (const entry of likeFiles) {
        const content = entry.getData().toString('utf8');
        const jsonContent = this.stripJsWrapper(content);
        const data = JSON.parse(jsonContent);

        const likeList = Array.isArray(data) ? data : [];
        const items = likeList.flatMap((item: any) => item.like || item);

        for (const item of items) {
          const postId = String(item.tweetId || item.id || '');
          if (!postId) continue;
          likes.push({
            userId: 'me',
            postId,
            platform: this.platform,
            likedAt: item.likeDate ? new Date(item.likeDate) : undefined,
            postText: item.fullText || item.full_text || undefined,
            postUrl: item.expandedUrl || item.url || undefined,
          });
        }
      }
    } catch (error) {
      console.error('Error extracting X likes:', error);
    }

    return likes;
  }

  async extractComments(zipPath: string): Promise<NormalizedComment[]> {
    const zip = new AdmZip(zipPath);
    const comments: NormalizedComment[] = [];

    try {
      const entries = zip.getEntries();
      const commentFiles = entries.filter(entry =>
        entry.entryName.includes('tweet') && entry.entryName.endsWith('.js')
      );

      for (const entry of commentFiles) {
        const content = entry.getData().toString('utf8');
        const jsonContent = this.stripJsWrapper(content);
        const data = JSON.parse(jsonContent);

        const tweetList = Array.isArray(data) ? data : [];
        const items = tweetList.flatMap((item: any) => item.tweet || item);

        for (const item of items) {
          if (item.in_reply_to_status_id_str) {
            comments.push({
              originalPlatformId: item.id_str || item.id || `x_comment_${Date.now()}_${Math.random()}`,
              platform: this.platform,
              postId: item.in_reply_to_status_id_str || 'unknown',
              userId: item.user?.id_str || item.user?.screen_name || 'unknown',
              content: item.full_text || item.text || '',
              createdAt: item.created_at ? new Date(item.created_at) : new Date(),
              likesCount: item.favorite_count || 0,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error extracting X comments:', error);
    }

    return comments;
  }
}
