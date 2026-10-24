import { z } from 'zod';
import {
  NormalizedPost,
  NormalizedUser,
  NormalizedFollowRelation,
  NormalizedLike,
  NormalizedComment,
  PostSchema,
  UserSchema,
  FollowRelationSchema,
  LikeSchema,
  CommentSchema,
} from '../../types/schemas';

export interface NormalizationResult {
  posts: NormalizedPost[];
  users: NormalizedUser[];
  followRelations: NormalizedFollowRelation[];
  likes: NormalizedLike[];
  comments: NormalizedComment[];
  errors: string[];
}

export class DataNormalizer {
  static normalizePosts(rawPosts: any[]): { posts: NormalizedPost[]; errors: string[] } {
    const posts: NormalizedPost[] = [];
    const errors: string[] = [];

    for (const rawPost of rawPosts) {
      try {
        const validatedPost = PostSchema.parse(rawPost);
        posts.push(validatedPost);
      } catch (error) {
        if (error instanceof z.ZodError) {
          errors.push(`Post validation failed: ${error.message}`);
        } else {
          errors.push(`Unknown error validating post: ${error}`);
        }
      }
    }

    return { posts, errors };
  }

  static normalizeUsers(rawUsers: any[]): { users: NormalizedUser[]; errors: string[] } {
    const users: NormalizedUser[] = [];
    const errors: string[] = [];

    for (const rawUser of rawUsers) {
      try {
        const validatedUser = UserSchema.parse(rawUser);
        users.push(validatedUser);
      } catch (error) {
        if (error instanceof z.ZodError) {
          errors.push(`User validation failed: ${error.message}`);
        } else {
          errors.push(`Unknown error validating user: ${error}`);
        }
      }
    }

    return { users, errors };
  }

  static normalizeFollowRelations(rawRelations: any[]): { relations: NormalizedFollowRelation[]; errors: string[] } {
    const relations: NormalizedFollowRelation[] = [];
    const errors: string[] = [];

    for (const rawRelation of rawRelations) {
      try {
        const validatedRelation = FollowRelationSchema.parse(rawRelation);
        relations.push(validatedRelation);
      } catch (error) {
        if (error instanceof z.ZodError) {
          errors.push(`Follow relation validation failed: ${error.message}`);
        } else {
          errors.push(`Unknown error validating follow relation: ${error}`);
        }
      }
    }

    return { relations, errors };
  }

  static normalizeLikes(rawLikes: any[]): { likes: NormalizedLike[]; errors: string[] } {
    const likes: NormalizedLike[] = [];
    const errors: string[] = [];

    for (const rawLike of rawLikes) {
      try {
        const validatedLike = LikeSchema.parse(rawLike);
        likes.push(validatedLike);
      } catch (error) {
        if (error instanceof z.ZodError) {
          errors.push(`Like validation failed: ${error.message}`);
        } else {
          errors.push(`Unknown error validating like: ${error}`);
        }
      }
    }

    return { likes, errors };
  }

  static normalizeComments(rawComments: any[]): { comments: NormalizedComment[]; errors: string[] } {
    const comments: NormalizedComment[] = [];
    const errors: string[] = [];

    for (const rawComment of rawComments) {
      try {
        const validatedComment = CommentSchema.parse(rawComment);
        comments.push(validatedComment);
      } catch (error) {
        if (error instanceof z.ZodError) {
          errors.push(`Comment validation failed: ${error.message}`);
        } else {
          errors.push(`Unknown error validating comment: ${error}`);
        }
      }
    }

    return { comments, errors };
  }

  static normalizeAll(rawData: {
    posts?: any[];
    users?: any[];
    followRelations?: any[];
    likes?: any[];
    comments?: any[];
  }): NormalizationResult {
    const result: NormalizationResult = {
      posts: [],
      users: [],
      followRelations: [],
      likes: [],
      comments: [],
      errors: [],
    };

    if (rawData.posts) {
      const { posts, errors } = this.normalizePosts(rawData.posts);
      result.posts = posts;
      result.errors.push(...errors);
    }

    if (rawData.users) {
      const { users, errors } = this.normalizeUsers(rawData.users);
      result.users = users;
      result.errors.push(...errors);
    }

    if (rawData.followRelations) {
      const { relations, errors } = this.normalizeFollowRelations(rawData.followRelations);
      result.followRelations = relations;
      result.errors.push(...errors);
    }

    if (rawData.likes) {
      const { likes, errors } = this.normalizeLikes(rawData.likes);
      result.likes = likes;
      result.errors.push(...errors);
    }

    if (rawData.comments) {
      const { comments, errors } = this.normalizeComments(rawData.comments);
      result.comments = comments;
      result.errors.push(...errors);
    }

    return result;
  }

  static deduplicatePosts(posts: NormalizedPost[]): NormalizedPost[] {
    const seen = new Set<string>();
    return posts.filter(post => {
      const key = `${post.platform}_${post.originalPlatformId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  static deduplicateUsers(users: NormalizedUser[]): NormalizedUser[] {
    const seen = new Set<string>();
    return users.filter(user => {
      const key = `${user.platform}_${user.originalPlatformId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}
