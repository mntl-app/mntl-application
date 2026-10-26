import { z } from 'zod';

export const PlatformEnum = z.enum(['instagram', 'facebook', 'x', 'tiktok']);
export type Platform = z.infer<typeof PlatformEnum>;

export const MetricsSchema = z.object({
  likesCount: z.number().default(0),
  commentsCount: z.number().default(0),
  sharesCount: z.number().default(0),
  viewsCount: z.number().default(0),
});

export type Metrics = z.infer<typeof MetricsSchema>;

export const PostSchema = z.object({
  originalPlatformId: z.string(),
  platform: PlatformEnum,
  postType: z.enum(['post', 'reel', 'text']).optional(),
  isReply: z.boolean().optional(),
  replyToPostId: z.string().optional(),
  content: z.string().optional(),
  mediaUrls: z.array(z.string()).optional(),
  mediaTypes: z.array(z.enum(['image', 'video', 'none'])).optional(),
  createdAt: z.date(),
  updatedAt: z.date().optional(),
  metrics: MetricsSchema.optional(),
  hashtags: z.array(z.string()).optional(),
  mentions: z.array(z.string()).optional(),
  location: z.string().optional(),
  isDeleted: z.boolean().default(false),
});

export type NormalizedPost = z.infer<typeof PostSchema>;

export const UserSchema = z.object({
  originalPlatformId: z.string(),
  platform: PlatformEnum,
  username: z.string(),
  displayName: z.string().optional(),
  bio: z.string().optional(),
  profilePictureUrl: z.string().optional(),
  followersCount: z.number().default(0),
  followingCount: z.number().default(0),
  postsCount: z.number().default(0),
  verified: z.boolean().default(false),
  joinedAt: z.date().optional(),
});

export type NormalizedUser = z.infer<typeof UserSchema>;

export const FollowRelationSchema = z.object({
  followerId: z.string(),
  followingId: z.string(),
  platform: PlatformEnum,
  followedAt: z.date().optional(),
});

export type NormalizedFollowRelation = z.infer<typeof FollowRelationSchema>;

export const LikeSchema = z.object({
  userId: z.string(),
  postId: z.string(),
  platform: PlatformEnum,
  likedAt: z.date().optional(),
  postUrl: z.string().optional(),
  postText: z.string().optional(),
  postShortcode: z.string().optional(),
});

export type NormalizedLike = z.infer<typeof LikeSchema>;

export const CommentSchema = z.object({
  originalPlatformId: z.string(),
  platform: PlatformEnum,
  postId: z.string(),
  postOwnerId: z.string().optional(),
  postUrl: z.string().optional(),
  userId: z.string(),
  content: z.string(),
  createdAt: z.date(),
  likesCount: z.number().default(0),
});

export type NormalizedComment = z.infer<typeof CommentSchema>;

export const MigrationJobSchema = z.object({
  jobId: z.string(),
  platform: PlatformEnum,
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  progress: z.number().min(0).max(100).default(0),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  error: z.string().optional(),
  totalPosts: z.number().default(0),
  processedPosts: z.number().default(0),
});

export type MigrationJob = z.infer<typeof MigrationJobSchema>;
