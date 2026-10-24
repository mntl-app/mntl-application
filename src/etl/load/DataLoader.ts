import {
  NormalizedPost,
  NormalizedLike,
  NormalizedUser,
  NormalizedFollowRelation,
  NormalizedComment,
} from '../../types/schemas';

export interface LikePostMatch {
  like: NormalizedLike;
  matchedPost: NormalizedPost | null;
  matchType: 'id' | 'text' | null;
}

function normalizeMatchText(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
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
  private followRelations: NormalizedFollowRelation[] = [];
  private likes: NormalizedLike[] = [];
  private comments: NormalizedComment[] = [];

  async connect(): Promise<void> {
    console.log('In-memory data loader connected');
  }

  async disconnect(): Promise<void> {
    console.log('In-memory data loader disconnected');
  }

  async savePosts(posts: NormalizedPost[]): Promise<number> {
    let saved = 0;
    for (const post of posts) {
      const key = `${post.platform}_${post.originalPlatformId}`;
      if (!this.posts.has(key)) {
        this.posts.set(key, post);
        saved++;
      }
    }
    return saved;
  }

  async saveUsers(users: NormalizedUser[]): Promise<number> {
    let saved = 0;
    for (const user of users) {
      const key = `${user.platform}_${user.originalPlatformId}`;
      if (!this.users.has(key)) {
        this.users.set(key, user);
        saved++;
      }
    }
    return saved;
  }

  async saveFollowRelations(relations: NormalizedFollowRelation[]): Promise<number> {
    let saved = 0;
    for (const relation of relations) {
      const key = `${relation.platform}_${relation.followerId}_${relation.followingId}`;
      const exists = this.followRelations.some(
        r => `${r.platform}_${r.followerId}_${r.followingId}` === key
      );
      if (!exists) {
        this.followRelations.push(relation);
        saved++;
      }
    }
    return saved;
  }

  async saveLikes(likes: NormalizedLike[]): Promise<number> {
    let saved = 0;
    for (const like of likes) {
      const key = `${like.platform}_${like.userId}_${like.postId}`;
      const exists = this.likes.some(
        l => `${l.platform}_${l.userId}_${l.postId}` === key
      );
      if (!exists) {
        this.likes.push(like);
        saved++;
      }
    }
    return saved;
  }

  async saveComments(comments: NormalizedComment[]): Promise<number> {
    let saved = 0;
    for (const comment of comments) {
      const key = `${comment.platform}_${comment.originalPlatformId}`;
      const exists = this.comments.some(
        c => `${c.platform}_${c.originalPlatformId}` === key
      );
      if (!exists) {
        this.comments.push(comment);
        saved++;
      }
    }
    return saved;
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
    return [...this.followRelations];
  }

  getLikes(): NormalizedLike[] {
    return [...this.likes];
  }

  getLikeMatches(): LikePostMatch[] {
    const postsById = new Map<string, NormalizedPost>();
    const postsByText = new Map<string, NormalizedPost[]>();

    for (const post of this.posts.values()) {
      postsById.set(postKey(post.platform, post.originalPlatformId), post);
      if (!post.content) continue;

      const textKey = normalizeMatchText(post.content);
      if (!textKey) continue;
      const matchingPosts = postsByText.get(`${post.platform}\u0000${textKey}`) || [];
      matchingPosts.push(post);
      postsByText.set(`${post.platform}\u0000${textKey}`, matchingPosts);
    }

    return this.likes.map(like => {
      const idMatch = postsById.get(postKey(like.platform, like.postId));
      if (idMatch) {
        return { like, matchedPost: idMatch, matchType: 'id' };
      }

      const textKey = like.postText ? normalizeMatchText(like.postText) : '';
      const matchingPosts = textKey
        ? postsByText.get(`${like.platform}\u0000${textKey}`) || []
        : [];
      if (matchingPosts.length === 1) {
        return { like, matchedPost: matchingPosts[0], matchType: 'text' };
      }

      return { like, matchedPost: null, matchType: null };
    });
  }

  getComments(): NormalizedComment[] {
    return [...this.comments];
  }
}
