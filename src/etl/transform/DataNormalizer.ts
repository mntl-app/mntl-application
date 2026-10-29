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

function validateAll<T extends z.ZodType>(
  schema: T,
  label: string,
  rawItems: unknown[] | undefined,
  errors: string[]
): z.infer<T>[] {
  const validItems: z.infer<T>[] = [];
  for (const rawItem of rawItems || []) {
    try {
      validItems.push(schema.parse(rawItem));
    } catch (error) {
      if (error instanceof z.ZodError) {
        errors.push(`${label} validation failed: ${error.message}`);
      } else {
        errors.push(`Unknown error validating ${label.toLowerCase()}: ${error}`);
      }
    }
  }
  return validItems;
}

export class DataNormalizer {
  static normalizeAll(rawData: {
    posts?: unknown[];
    users?: unknown[];
    followRelations?: unknown[];
    likes?: unknown[];
    comments?: unknown[];
  }): NormalizationResult {
    const errors: string[] = [];
    return {
      posts: validateAll(PostSchema, 'Post', rawData.posts, errors),
      users: validateAll(UserSchema, 'User', rawData.users, errors),
      followRelations: validateAll(FollowRelationSchema, 'Follow relation', rawData.followRelations, errors),
      likes: validateAll(LikeSchema, 'Like', rawData.likes, errors),
      comments: validateAll(CommentSchema, 'Comment', rawData.comments, errors),
      errors,
    };
  }
}
