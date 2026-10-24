import AdmZip from 'adm-zip';
import { BaseAdapter } from '../BaseAdapter';
import { NormalizedPost, NormalizedUser, NormalizedFollowRelation, NormalizedLike, NormalizedComment, Platform } from '../../types/schemas';

export class FacebookAdapter extends BaseAdapter {
  readonly platform: Platform = 'facebook';

  detect(zipEntries: string[]): boolean {
    return zipEntries.some(entry => {
      const normalizedEntry = entry.toLowerCase();
      return normalizedEntry.includes('facebook') ||
        normalizedEntry.includes('your_facebook_activity/');
    });
  }

  async extractPosts(zipPath: string): Promise<NormalizedPost[]> {
    const zip = new AdmZip(zipPath);
    const posts: NormalizedPost[] = [];

    try {
      const entries = zip.getEntries();
      const postFiles = entries.filter(entry =>
        entry.entryName.includes('posts') &&
        (entry.entryName.endsWith('.json') || entry.entryName.endsWith('.html'))
      );

      for (const entry of postFiles) {
        const content = entry.getData().toString('utf8');

        if (entry.entryName.endsWith('.json')) {
          const data = JSON.parse(content);
          const extractedPosts = this.parsePostJSON(data);
          posts.push(...extractedPosts);
        }
      }
    } catch (error) {
      console.error('Error extracting Facebook posts:', error);
    }

    return posts;
  }

  private parsePostJSON(data: any): NormalizedPost[] {
    const posts: NormalizedPost[] = [];

    try {
      const postList = data.posts || data;
      const items = Array.isArray(postList) ? postList : postList.data || [];

      for (const item of items) {
        const post: NormalizedPost = {
          originalPlatformId: item.id || item.post_id || `fb_${Date.now()}_${Math.random()}`,
          platform: this.platform,
          content: item.data?.[0]?.post?.text || item.text || undefined,
          mediaUrls: item.attachments?.data?.map((a: any) => a.media?.source).filter(Boolean) || undefined,
          mediaTypes: item.attachments?.data?.map((a: any) => a.media?.type === 'video' ? 'video' : 'image') || undefined,
          createdAt: item.timestamp ? new Date(item.timestamp) : new Date(),
          metrics: {
            likesCount: item.reactions?.summary?.total_count || 0,
            commentsCount: item.comments?.summary?.total_count || 0,
            sharesCount: item.shares?.count || 0,
            viewsCount: 0,
          },
          isDeleted: false,
        };
        posts.push(post);
      }
    } catch (error) {
      console.error('Error parsing Facebook post JSON:', error);
    }

    return posts;
  }

  async extractUsers(zipPath: string): Promise<NormalizedUser[]> {
    const zip = new AdmZip(zipPath);
    const users: NormalizedUser[] = [];

    try {
      const entries = zip.getEntries();
      const profileFiles = entries.filter(entry =>
        entry.entryName.includes('profile') && entry.entryName.endsWith('.json')
      );

      for (const entry of profileFiles) {
        const content = entry.getData().toString('utf8');
        const data = JSON.parse(content);

        const user: NormalizedUser = {
          originalPlatformId: data.id || `fb_user_${Date.now()}`,
          platform: this.platform,
          username: data.username || data.name || 'unknown',
          displayName: data.name || undefined,
          bio: data.bio || undefined,
          profilePictureUrl: data.profile_pic_url || undefined,
          followersCount: 0,
          followingCount: 0,
          postsCount: 0,
          verified: false,
          joinedAt: data.joined_at ? new Date(data.joined_at) : undefined,
        };
        users.push(user);
      }
    } catch (error) {
      console.error('Error extracting Facebook users:', error);
    }

    return users;
  }

  async extractFollowRelations(zipPath: string): Promise<NormalizedFollowRelation[]> {
    const zip = new AdmZip(zipPath);
    const relations: NormalizedFollowRelation[] = [];

    try {
      const entries = zip.getEntries();
      const followFiles = entries.filter(entry =>
        (entry.entryName.toLowerCase().includes('following') ||
          entry.entryName.toLowerCase().includes('followers')) &&
        entry.entryName.endsWith('.json')
      );

      for (const entry of followFiles) {
        const content = entry.getData().toString('utf8');
        const data = JSON.parse(content);
        const isFollowingList = entry.entryName.toLowerCase().includes('following');

        const relationList = Array.isArray(data)
          ? data
          : data.following || data.followers || data.data || [];
        const items = Array.isArray(relationList) ? relationList : relationList.data || [];

        for (const item of items) {
          const accountId = item.name || item.username || 'unknown';
          relations.push({
            followerId: isFollowingList ? 'me' : accountId,
            followingId: isFollowingList ? accountId : 'me',
            platform: this.platform,
            followedAt: item.timestamp ? new Date(item.timestamp) : undefined,
          });
        }
      }
    } catch (error) {
      console.error('Error extracting Facebook follow relations:', error);
    }

    return relations;
  }

  async extractLikes(zipPath: string): Promise<NormalizedLike[]> {
    const zip = new AdmZip(zipPath);
    const likes: NormalizedLike[] = [];

    try {
      const entries = zip.getEntries();
      const likeFiles = entries.filter(entry =>
        entry.entryName.includes('likes') && entry.entryName.endsWith('.json')
      );

      for (const entry of likeFiles) {
        const content = entry.getData().toString('utf8');
        const data = JSON.parse(content);

        const likeList = data.likes || data;
        const items = Array.isArray(likeList) ? likeList : likeList.data || [];

        for (const item of items) {
          likes.push({
            userId: item.name || 'unknown',
            postId: item.id || 'unknown',
            platform: this.platform,
            likedAt: item.timestamp ? new Date(item.timestamp) : undefined,
          });
        }
      }
    } catch (error) {
      console.error('Error extracting Facebook likes:', error);
    }

    return likes;
  }

  async extractComments(zipPath: string): Promise<NormalizedComment[]> {
    const zip = new AdmZip(zipPath);
    const comments: NormalizedComment[] = [];

    try {
      const entries = zip.getEntries();
      const commentFiles = entries.filter(entry =>
        entry.entryName.includes('comments') && entry.entryName.endsWith('.json')
      );

      for (const entry of commentFiles) {
        const content = entry.getData().toString('utf8');
        const data = JSON.parse(content);

        const commentList = data.comments || data;
        const items = Array.isArray(commentList) ? commentList : commentList.data || [];

        for (const item of items) {
          comments.push({
            originalPlatformId: item.id || `fb_comment_${Date.now()}_${Math.random()}`,
            platform: this.platform,
            postId: item.post_id || 'unknown',
            userId: item.author || item.name || 'unknown',
            content: item.data?.[0]?.comment?.text || item.text || '',
            createdAt: item.timestamp ? new Date(item.timestamp) : new Date(),
            likesCount: item.reactions?.summary?.total_count || 0,
          });
        }
      }
    } catch (error) {
      console.error('Error extracting Facebook comments:', error);
    }

    return comments;
  }
}
