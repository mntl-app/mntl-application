import {
  NormalizedPost,
  NormalizedLike,
  NormalizedUser,
  NormalizedFollowRelation,
  NormalizedComment,
} from '../../types/schemas';
import { likeTextKey, textKey } from './Identity';

export interface LikePostMatch {
  like: NormalizedLike;
  matchedPost: NormalizedPost | null;
  matchType: 'id' | 'text' | null;
}

function postKey(platform: string, postId: string): string {
  return `${platform}\u0000${postId}`;
}

export interface IDataLoader {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  savePosts(posts: NormalizedPost[]): Promise<number>;
  saveUsers(users: NormalizedUser[]): Promise<number>;
  saveFollowRelations(relations: NormalizedFollowRelation[]): Promise<number>;
  saveLikes(likes: NormalizedLike[]): Promise<number>;
  saveComments(comments: NormalizedComment[]): Promise<number>;
  clearPosts(): Promise<void>;
  clearUsers(): Promise<void>;
}

export abstract class BaseDataLoader implements IDataLoader {
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract savePosts(posts: NormalizedPost[]): Promise<number>;
  abstract saveUsers(users: NormalizedUser[]): Promise<number>;
  abstract saveFollowRelations(relations: NormalizedFollowRelation[]): Promise<number>;
  abstract saveLikes(likes: NormalizedLike[]): Promise<number>;
  abstract saveComments(comments: NormalizedComment[]): Promise<number>;
  abstract clearPosts(): Promise<void>;
  abstract clearUsers(): Promise<void>;
}

export class InMemoryDataLoader extends BaseDataLoader {
  private posts: Map<string, NormalizedPost> = new Map();
  private users: Map<string, NormalizedUser> = new Map();
  private followRelations: Map<string, NormalizedFollowRelation> = new Map();
  private likes: Map<string, NormalizedLike> = new Map();
  private comments: Map<string, NormalizedComment> = new Map();

  async connect(): Promise<void> {
    console.log('In-memory data loader connected');
  }

  async disconnect(): Promise<void> {
    console.log('In-memory data loader disconnected');
  }

  private saveUnique<T>(store: Map<string, T>, items: T[], keyOf: (item: T) => string): number {
    let saved = 0;
    for (const item of items) {
      const key = keyOf(item);
      if (!store.has(key)) {
        store.set(key, item);
        saved++;
      }
    }
    return saved;
  }

  async savePosts(posts: NormalizedPost[]): Promise<number> {
    return this.saveUnique(this.posts, posts, post => `${post.platform}_${post.originalPlatformId}`);
  }

  async saveUsers(users: NormalizedUser[]): Promise<number> {
    return this.saveUnique(this.users, users, user => `${user.platform}_${user.originalPlatformId}`);
  }

  async saveFollowRelations(relations: NormalizedFollowRelation[]): Promise<number> {
    return this.saveUnique(
      this.followRelations,
      relations,
      relation => `${relation.platform}_${relation.followerId}_${relation.followingId}`
    );
  }

  async saveLikes(likes: NormalizedLike[]): Promise<number> {
    return this.saveUnique(this.likes, likes, like => `${like.platform}_${like.userId}_${like.postId}`);
  }

  async saveComments(comments: NormalizedComment[]): Promise<number> {
    return this.saveUnique(this.comments, comments, comment => `${comment.platform}_${comment.originalPlatformId}`);
  }

  async clearPosts(): Promise<void> {
    this.posts.clear();
  }

  async clearUsers(): Promise<void> {
    this.users.clear();
  }

  getPosts(): NormalizedPost[] {
    return Array.from(this.posts.values());
  }

  getUsers(): NormalizedUser[] {
    return Array.from(this.users.values());
  }

  getFollowRelations(): NormalizedFollowRelation[] {
    return [...this.followRelations.values()];
  }

  getLikes(): NormalizedLike[] {
    return [...this.likes.values()];
  }

  getLikeMatches(): LikePostMatch[] {
    const postsById = new Map<string, NormalizedPost>();
    const postsByText = new Map<string, NormalizedPost[]>();

    for (const post of this.posts.values()) {
      postsById.set(postKey(post.platform, post.originalPlatformId), post);
      const contentKey = textKey(post.platform, post.content);
      if (!contentKey) continue;
      postsByText.set(contentKey, [...(postsByText.get(contentKey) || []), post]);
    }

    return [...this.likes.values()].map(like => {
      const idMatch = postsById.get(postKey(like.platform, like.postId));
      if (idMatch) {
        return { like, matchedPost: idMatch, matchType: 'id' };
      }

      const likedTextKey = likeTextKey(like);
      const matchingPosts = likedTextKey ? postsByText.get(likedTextKey) || [] : [];
      if (matchingPosts.length === 1) {
        return { like, matchedPost: matchingPosts[0], matchType: 'text' };
      }

      return { like, matchedPost: null, matchType: null };
    });
  }

  getComments(): NormalizedComment[] {
    return [...this.comments.values()];
  }
}
