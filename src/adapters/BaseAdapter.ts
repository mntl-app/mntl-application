import { NormalizedPost, NormalizedUser, NormalizedFollowRelation, NormalizedLike, NormalizedComment, Platform } from '../types/schemas';

export interface IPlatformAdapter {
  readonly platform: Platform;

  detect(zipEntries: string[]): boolean;

  extractPosts(zipPath: string): Promise<NormalizedPost[]>;

  extractUsers(zipPath: string): Promise<NormalizedUser[]>;

  extractFollowRelations(zipPath: string): Promise<NormalizedFollowRelation[]>;

  extractLikes(zipPath: string): Promise<NormalizedLike[]>;

  extractComments(zipPath: string): Promise<NormalizedComment[]>;

  validateArchive(zipPath: string): Promise<boolean>;
}

export abstract class BaseAdapter implements IPlatformAdapter {
  abstract readonly platform: Platform;

  abstract detect(zipEntries: string[]): boolean;

  abstract extractPosts(zipPath: string): Promise<NormalizedPost[]>;

  abstract extractUsers(zipPath: string): Promise<NormalizedUser[]>;

  abstract extractFollowRelations(zipPath: string): Promise<NormalizedFollowRelation[]>;

  abstract extractLikes(zipPath: string): Promise<NormalizedLike[]>;

  abstract extractComments(zipPath: string): Promise<NormalizedComment[]>;

  async validateArchive(zipPath: string): Promise<boolean> {
    try {
      return true;
    } catch (error) {
      console.error(`Archive validation failed for ${this.platform}:`, error);
      return false;
    }
  }
}
