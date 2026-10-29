import {
  NormalizedPost,
  NormalizedUser,
  NormalizedFollowRelation,
  NormalizedLike,
  NormalizedComment,
  Platform,
} from '../types/schemas';

export interface IPlatformAdapter {
  readonly platform: Platform;

  detect(zipEntries: string[]): boolean;

  extractPosts(zipPath: string): Promise<NormalizedPost[]>;

  extractUsers(zipPath: string): Promise<NormalizedUser[]>;

  extractFollowRelations(zipPath: string): Promise<NormalizedFollowRelation[]>;

  extractLikes(zipPath: string): Promise<NormalizedLike[]>;

  extractComments(zipPath: string): Promise<NormalizedComment[]>;

  validateArchive(zipPath: string): Promise<boolean>;

  // Explains data an export is likely missing, e.g. because of a limited date range.
  describeLimitations(zipPath: string): Promise<string[]>;
}

export abstract class BaseAdapter implements IPlatformAdapter {
  abstract readonly platform: Platform;

  abstract detect(zipEntries: string[]): boolean;

  abstract extractPosts(zipPath: string): Promise<NormalizedPost[]>;

  abstract extractUsers(zipPath: string): Promise<NormalizedUser[]>;

  abstract extractFollowRelations(zipPath: string): Promise<NormalizedFollowRelation[]>;

  abstract extractLikes(zipPath: string): Promise<NormalizedLike[]>;

  abstract extractComments(zipPath: string): Promise<NormalizedComment[]>;

  async validateArchive(_zipPath: string): Promise<boolean> {
    return true;
  }

  async describeLimitations(_zipPath: string): Promise<string[]> {
    return [];
  }
}
