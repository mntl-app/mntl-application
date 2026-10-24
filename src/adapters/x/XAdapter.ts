import AdmZip from 'adm-zip';
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
        entry.entryName.includes('tweets') && entry.entryName.endsWith('.js')
      );

      for (const entry of tweetFiles) {
        const content = entry.getData().toString('utf8');
        const jsonContent = this.stripJsWrapper(content);
        const data = JSON.parse(jsonContent);

        const extractedPosts = this.parseTweets(data);
        posts.push(...extractedPosts);
      }
    } catch (error) {
      console.error('Error extracting X posts:', error);
    }

    return posts;
  }

  private stripJsWrapper(content: string): string {
    const match = content.match(/\[.*\]/s);
    return match ? match[0] : content;
  }

  private parseTweets(data: any): NormalizedPost[] {
    const posts: NormalizedPost[] = [];

    try {
      const tweetList = Array.isArray(data) ? data : [];
      const items = tweetList.flatMap((item: any) => item.tweet || item);

      for (const item of items) {
        const post: NormalizedPost = {
          originalPlatformId: item.id_str || item.id || `x_${Date.now()}_${Math.random()}`,
          platform: this.platform,
          content: item.full_text || item.text || undefined,
          mediaUrls: item.extended_entities?.media?.map((m: any) => m.media_url_https).filter(Boolean) || undefined,
          mediaTypes: item.extended_entities?.media?.map((m: any) => m.type === 'video' ? 'video' : 'image') || undefined,
          createdAt: item.created_at ? new Date(item.created_at) : new Date(),
          metrics: {
            likesCount: item.favorite_count || 0,
            commentsCount: item.reply_count || 0,
            sharesCount: item.retweet_count || 0,
            viewsCount: item.view_count || 0,
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
        entry.entryName.includes('account') && entry.entryName.endsWith('.js')
      );

      for (const entry of accountFiles) {
        const content = entry.getData().toString('utf8');
        const jsonContent = this.stripJsWrapper(content);
        const data = JSON.parse(jsonContent);

        const user: NormalizedUser = {
          originalPlatformId: data[0]?.account?.id_str || `x_user_${Date.now()}`,
          platform: this.platform,
          username: data[0]?.account?.username || 'unknown',
          displayName: data[0]?.account?.name || undefined,
          bio: data[0]?.account?.description || undefined,
          profilePictureUrl: data[0]?.account?.profile_image_url_https || undefined,
          followersCount: data[0]?.account?.followers_count || 0,
          followingCount: data[0]?.account?.friends_count || 0,
          postsCount: data[0]?.account?.statuses_count || 0,
          verified: data[0]?.account?.verified || false,
          joinedAt: data[0]?.account?.created_at ? new Date(data[0].account.created_at) : undefined,
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
        (entry.entryName.includes('following') || entry.entryName.includes('followers')) &&
        entry.entryName.endsWith('.js')
      );

      for (const entry of followFiles) {
        const content = entry.getData().toString('utf8');
        const jsonContent = this.stripJsWrapper(content);
        const data = JSON.parse(jsonContent);
        const isFollowingList = entry.entryName.toLowerCase().includes('following');

        const followList = Array.isArray(data) ? data : [];
        const items = followList.flatMap((item: any) => item.following || item.follower || item);

        for (const item of items) {
          const accountId = item.account_id || item.username || 'unknown';
          relations.push({
            followerId: isFollowingList ? 'me' : accountId,
            followingId: isFollowingList ? accountId : 'me',
            platform: this.platform,
            followedAt: item.account_created_at ? new Date(item.account_created_at) : undefined,
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
        entry.entryName.includes('like') && entry.entryName.endsWith('.js')
      );

      for (const entry of likeFiles) {
        const content = entry.getData().toString('utf8');
        const jsonContent = this.stripJsWrapper(content);
        const data = JSON.parse(jsonContent);

        const likeList = Array.isArray(data) ? data : [];
        const items = likeList.flatMap((item: any) => item.like || item);

        for (const item of items) {
          likes.push({
            userId: item.account_id || 'unknown',
            postId: item.tweetId || item.id || 'unknown',
            platform: this.platform,
            likedAt: item.likeDate ? new Date(item.likeDate) : undefined,
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
