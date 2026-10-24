import AdmZip from 'adm-zip';
import { BaseAdapter } from '../BaseAdapter';
import { NormalizedPost, NormalizedUser, NormalizedFollowRelation, NormalizedLike, NormalizedComment, Platform } from '../../types/schemas';

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
    const posts: NormalizedPost[] = [];

    try {
      const entries = zip.getEntries();
      const postFiles = entries.filter(entry =>
        entry.entryName.includes('video') &&
        (entry.entryName.endsWith('.json') || entry.entryName.endsWith('.csv'))
      );

      for (const entry of postFiles) {
        const content = entry.getData().toString('utf8');

        if (entry.entryName.endsWith('.json')) {
          const data = JSON.parse(content);
          const extractedPosts = this.parseVideoJSON(data);
          posts.push(...extractedPosts);
        } else if (entry.entryName.endsWith('.csv')) {
          const extractedPosts = this.parseVideoCSV(content);
          posts.push(...extractedPosts);
        }
      }
    } catch (error) {
      console.error('Error extracting TikTok posts:', error);
    }

    return posts;
  }

  private parseVideoJSON(data: any): NormalizedPost[] {
    const posts: NormalizedPost[] = [];

    try {
      const videoList = data.VideoList || data.videos || data;
      const items = Array.isArray(videoList) ? videoList : videoList.ItemList || [];

      for (const item of items) {
        const post: NormalizedPost = {
          originalPlatformId: item.VideoID || item.id || `tt_${Date.now()}_${Math.random()}`,
          platform: this.platform,
          content: item.Description || item.text || undefined,
          mediaUrls: item.VideoUrl ? [item.VideoUrl] : undefined,
          mediaTypes: ['video'],
          createdAt: item.Date ? new Date(item.Date) : new Date(),
          metrics: {
            likesCount: item.DiggCount || 0,
            commentsCount: item.CommentCount || 0,
            sharesCount: item.ShareCount || 0,
            viewsCount: item.PlayCount || 0,
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
        posts.push({
          originalPlatformId: `tt_${Date.now()}_${Math.random()}`,
          platform: this.platform,
          content: description || undefined,
          mediaUrls: videoUrl ? [videoUrl] : undefined,
          mediaTypes: ['video'],
          createdAt: new Date(date),
          metrics: {
            likesCount: parseInt(likes) || 0,
            commentsCount: parseInt(comments) || 0,
            sharesCount: parseInt(shares) || 0,
            viewsCount: parseInt(views) || 0,
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

  async extractLikes(zipPath: string): Promise<NormalizedLike[]> {
    const zip = new AdmZip(zipPath);
    const likes: NormalizedLike[] = [];

    try {
      const entries = zip.getEntries();
      const likeFiles = entries.filter(entry =>
        entry.entryName.includes('like') &&
        (entry.entryName.endsWith('.json') || entry.entryName.endsWith('.csv'))
      );

      for (const entry of likeFiles) {
        const content = entry.getData().toString('utf8');

        if (entry.entryName.endsWith('.json')) {
          const data = JSON.parse(content);
          const likeList = data.LikeList || data;
          const items = Array.isArray(likeList) ? likeList : likeList.ItemList || [];

          for (const item of items) {
            likes.push({
              userId: item.UserName || 'unknown',
              postId: item.VideoID || item.id || 'unknown',
              platform: this.platform,
              likedAt: item.LikeDate ? new Date(item.LikeDate) : undefined,
            });
          }
        } else if (entry.entryName.endsWith('.csv')) {
          const lines = content.split('\n').slice(1);
          for (const line of lines) {
            if (!line.trim()) continue;
            const [username, videoId, likeDate] = line.split(',').map(s => s?.trim());
            if (username && videoId) {
              likes.push({
                userId: username,
                postId: videoId,
                platform: this.platform,
                likedAt: likeDate ? new Date(likeDate) : undefined,
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Error extracting TikTok likes:', error);
    }

    return likes;
  }

  async extractComments(zipPath: string): Promise<NormalizedComment[]> {
    const zip = new AdmZip(zipPath);
    const comments: NormalizedComment[] = [];

    try {
      const entries = zip.getEntries();
      const commentFiles = entries.filter(entry =>
        entry.entryName.includes('comment') &&
        (entry.entryName.endsWith('.json') || entry.entryName.endsWith('.csv'))
      );

      for (const entry of commentFiles) {
        const content = entry.getData().toString('utf8');

        if (entry.entryName.endsWith('.json')) {
          const data = JSON.parse(content);
          const commentList = data.CommentList || data;
          const items = Array.isArray(commentList) ? commentList : commentList.ItemList || [];

          for (const item of items) {
            comments.push({
              originalPlatformId: item.CommentID || item.id || `tt_comment_${Date.now()}_${Math.random()}`,
              platform: this.platform,
              postId: item.VideoID || item.VideoId || 'unknown',
              userId: item.UserName || item.Username || 'unknown',
              content: item.CommentText || item.text || '',
              createdAt: item.CreateTime ? new Date(item.CreateTime) : new Date(),
              likesCount: item.DiggCount || 0,
            });
          }
        } else if (entry.entryName.endsWith('.csv')) {
          const lines = content.split('\n').slice(1);
          for (const line of lines) {
            if (!line.trim()) continue;
            const [videoId, username, commentText, createTime, likes] = line.split(',').map(s => s?.trim());
            if (username && commentText) {
              comments.push({
                originalPlatformId: `tt_comment_${Date.now()}_${Math.random()}`,
                platform: this.platform,
                postId: videoId || 'unknown',
                userId: username,
                content: commentText,
                createdAt: createTime ? new Date(createTime) : new Date(),
                likesCount: parseInt(likes) || 0,
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Error extracting TikTok comments:', error);
    }

    return comments;
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
