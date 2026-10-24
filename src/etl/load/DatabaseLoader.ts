import { BaseDataLoader } from './DataLoader';
import {
  NormalizedPost,
  NormalizedUser,
  NormalizedFollowRelation,
  NormalizedLike,
  NormalizedComment,
} from '../../types/schemas';

export class DatabaseLoader extends BaseDataLoader {
  private client: any;

  constructor(client: any) {
    super();
    this.client = client;
  }

  async connect(): Promise<void> {
    console.log('Database loader connected');
  }

  async disconnect(): Promise<void> {
    console.log('Database loader disconnected');
  }

  async savePosts(posts: NormalizedPost[]): Promise<number> {
    let saved = 0;
    try {
      for (const post of posts) {
        await this.client.query(
          `INSERT INTO posts (original_platform_id, platform, content, media_urls, media_types, created_at, updated_at, metrics, hashtags, mentions, location, is_deleted)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (original_platform_id, platform) DO UPDATE SET
             content = EXCLUDED.content,
             media_urls = EXCLUDED.media_urls,
             media_types = EXCLUDED.media_types,
             updated_at = EXCLUDED.updated_at,
             metrics = EXCLUDED.metrics,
             hashtags = EXCLUDED.hashtags,
             mentions = EXCLUDED.mentions,
             location = EXCLUDED.location`,
          [
            post.originalPlatformId,
            post.platform,
            post.content,
            post.mediaUrls,
            post.mediaTypes,
            post.createdAt,
            post.updatedAt,
            JSON.stringify(post.metrics),
            post.hashtags,
            post.mentions,
            post.location,
            post.isDeleted,
          ]
        );
        saved++;
      }
    } catch (error) {
      console.error('Error saving posts:', error);
    }
    return saved;
  }

  async saveUsers(users: NormalizedUser[]): Promise<number> {
    let saved = 0;
    try {
      for (const user of users) {
        await this.client.query(
          `INSERT INTO users (original_platform_id, platform, username, display_name, bio, profile_picture_url, followers_count, following_count, posts_count, verified, joined_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (original_platform_id, platform) DO UPDATE SET
             username = EXCLUDED.username,
             display_name = EXCLUDED.display_name,
             bio = EXCLUDED.bio,
             profile_picture_url = EXCLUDED.profile_picture_url,
             followers_count = EXCLUDED.followers_count,
             following_count = EXCLUDED.following_count,
             posts_count = EXCLUDED.posts_count,
             verified = EXCLUDED.verified,
             joined_at = EXCLUDED.joined_at`,
          [
            user.originalPlatformId,
            user.platform,
            user.username,
            user.displayName,
            user.bio,
            user.profilePictureUrl,
            user.followersCount,
            user.followingCount,
            user.postsCount,
            user.verified,
            user.joinedAt,
          ]
        );
        saved++;
      }
    } catch (error) {
      console.error('Error saving users:', error);
    }
    return saved;
  }

  async saveFollowRelations(relations: NormalizedFollowRelation[]): Promise<number> {
    let saved = 0;
    try {
      for (const relation of relations) {
        await this.client.query(
          `INSERT INTO follow_relations (follower_id, following_id, platform, followed_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (follower_id, following_id, platform) DO NOTHING`,
          [
            relation.followerId,
            relation.followingId,
            relation.platform,
            relation.followedAt,
          ]
        );
        saved++;
      }
    } catch (error) {
      console.error('Error saving follow relations:', error);
    }
    return saved;
  }

  async saveLikes(likes: NormalizedLike[]): Promise<number> {
    let saved = 0;
    try {
      for (const like of likes) {
        await this.client.query(
          `INSERT INTO likes (user_id, post_id, platform, liked_at, post_url, post_text, post_shortcode)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, post_id, platform) DO NOTHING`,
          [
            like.userId,
            like.postId,
            like.platform,
            like.likedAt,
            like.postUrl,
            like.postText,
            like.postShortcode,
          ]
        );
        saved++;
      }
    } catch (error) {
      console.error('Error saving likes:', error);
    }
    return saved;
  }

  async saveComments(comments: NormalizedComment[]): Promise<number> {
    let saved = 0;
    try {
      for (const comment of comments) {
        await this.client.query(
          `INSERT INTO comments (original_platform_id, platform, post_id, user_id, content, created_at, likes_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (original_platform_id, platform) DO UPDATE SET
             content = EXCLUDED.content,
             likes_count = EXCLUDED.likes_count`,
          [
            comment.originalPlatformId,
            comment.platform,
            comment.postId,
            comment.userId,
            comment.content,
            comment.createdAt,
            comment.likesCount,
          ]
        );
        saved++;
      }
    } catch (error) {
      console.error('Error saving comments:', error);
    }
    return saved;
  }

  async clearPosts(): Promise<void> {
    try {
      await this.client.query('DELETE FROM posts');
    } catch (error) {
      console.error('Error clearing posts:', error);
    }
  }

  async clearUsers(): Promise<void> {
    try {
      await this.client.query('DELETE FROM users');
    } catch (error) {
      console.error('Error clearing users:', error);
    }
  }
}
