import AdmZip from 'adm-zip';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { BaseAdapter } from '../BaseAdapter';
import { ZipExtractor } from '../../etl/extract/ZipExtractor';
import { fixMetaEncoding } from '../metaText';
import { NormalizedPost, NormalizedUser, NormalizedFollowRelation, NormalizedLike, NormalizedComment, Platform } from '../../types/schemas';

// Liked-post captions are labelled in the export's language.
const CAPTION_LABELS = new Set(['Caption', 'Légende', 'Bijschrift', 'Leyenda', 'Didascalia', 'Beschriftung', 'Legenda']);
const STORY_URL_PATTERN = /instagram\.com\/stories\/([^/?#]+)\/(\d+)/i;

export class InstagramAdapter extends BaseAdapter {
  readonly platform: Platform = 'instagram';

  private getRelationshipUsername(item: any): string | undefined {
    const stringData = Array.isArray(item.string_list_data) ? item.string_list_data[0] : undefined;
    const username = [item.title, item.username, stringData?.value]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?.trim();
    if (username) return username;

    if (typeof stringData?.href === 'string') {
      try {
        const segments = new URL(stringData.href).pathname.split('/').filter(Boolean);
        const profileSegment = segments[0] === '_u' ? segments[1] : segments[0];
        return profileSegment ? decodeURIComponent(profileSegment) : undefined;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  detect(zipEntries: string[]): boolean {
    return zipEntries.some(entry => {
      const normalizedEntry = entry.toLowerCase();
      return normalizedEntry.includes('your_instagram_activity/') ||
        normalizedEntry.includes('instagram_activity/');
    });
  }

  async extractPosts(zipPath: string): Promise<NormalizedPost[]> {
    const zip = ZipExtractor.open(zipPath);
    const posts: NormalizedPost[] = [];

    try {
      const entries = zip.getEntries();
      const postFiles = entries.filter(entry =>
        /your_instagram_activity\/media\/posts(?:_\d+)?\.json$/i.test(entry.entryName.replace(/\\/g, '/')) &&
        !entry.entryName.includes('/__MACOSX/') &&
        !path.basename(entry.entryName).startsWith('._')
      );
      const postRecords = postFiles.flatMap(entry => {
        const content = entry.getData().toString('utf8');
        const data = fixMetaEncoding(JSON.parse(content));
        return Array.isArray(data) ? data : [];
      });
      const reelFiles = entries.filter(entry =>
        /your_instagram_activity\/media\/reels(?:_\d+)?\.json$/i.test(entry.entryName.replace(/\\/g, '/')) &&
        !entry.entryName.includes('/__MACOSX/') &&
        !path.basename(entry.entryName).startsWith('._')
      );
      const reelRecords = reelFiles.flatMap(entry => {
        const data = fixMetaEncoding(JSON.parse(entry.getData().toString('utf8')));
        return Array.isArray(data)
          ? data
          : Array.isArray(data.ig_reels_media)
            ? data.ig_reels_media
            : [];
      });
      const primaryRecords = postRecords.filter(item => item.fbid || item.timestamp);
      const mediaRecords = postRecords.filter(item =>
        !item.fbid &&
        !item.timestamp &&
        Array.isArray(item.media) &&
        item.media.length > 0
      );

      if (primaryRecords.length > 0) {
        posts.push(...this.parsePostJSON(primaryRecords, 'post'));
        this.mergeRelatedMedia(posts, mediaRecords);
      } else {
        posts.push(...this.parsePostJSON(postRecords, 'post'));
      }
      posts.push(...this.parsePostJSON(reelRecords, 'reel'));
      posts.push(...this.parseStories(entries));
      this.removeDuplicateMediaFiles(posts, entries);
    } catch (error) {
      console.error('Error extracting Instagram posts:', error);
    }

    return posts;
  }

  // Stories (including those saved to highlights, which the export does not mark).
  private parseStories(entries: AdmZip.IZipEntry[]): NormalizedPost[] {
    const storyFiles = entries.filter(entry =>
      /your_instagram_activity\/media\/stories\.json$/i.test(entry.entryName.replace(/\\/g, '/')) &&
      !entry.entryName.includes('/__MACOSX/') &&
      !path.basename(entry.entryName).startsWith('._')
    );
    return storyFiles.flatMap(entry => {
      const data = fixMetaEncoding(JSON.parse(entry.getData().toString('utf8')));
      const stories = Array.isArray(data?.ig_stories) ? data.ig_stories : Array.isArray(data) ? data : [];
      return stories.flatMap((story: any): NormalizedPost[] => {
        const uri = typeof story?.uri === 'string' ? story.uri : '';
        const timestamp = Number(story?.creation_timestamp);
        if (!uri || !Number.isFinite(timestamp)) return [];
        // The file name is the story's media ID, which is also the ID in other users' story likes.
        const mediaId = path.basename(uri).replace(/\.[^.]+$/, '');
        const caption = typeof story.title === 'string' && story.title.trim() ? story.title : undefined;
        return [{
          originalPlatformId: /^\d+$/.test(mediaId) ? mediaId : `ig_story_${createHash('sha256').update(uri).digest('hex').slice(0, 24)}`,
          platform: this.platform,
          postType: 'story',
          content: caption,
          mediaUrls: [uri],
          mediaTypes: [story.media_metadata?.video_metadata || /\.(mp4|mov|webm)$/i.test(uri) ? 'video' : 'image'],
          createdAt: new Date(timestamp * 1000),
          metrics: { likesCount: 0, commentsCount: 0, sharesCount: 0, viewsCount: 0 },
          hashtags: caption ? this.extractHashtags(caption) : undefined,
          mentions: caption ? this.extractMentions(caption) : undefined,
          isDeleted: false,
        }];
      });
    });
  }

  private getPostCaption(item: any): string {
    if (typeof item.title === 'string' && item.title.trim()) return item.title;
    const mediaTitle = item.media?.find((media: any) =>
      typeof media.title === 'string' && media.title.trim()
    )?.title;
    if (mediaTitle) return mediaTitle;

    const captionLabel = item.label_values?.find((labelValue: any) =>
      typeof labelValue.label === 'string' &&
      /caption|description|legend|legenda|beschrift|bijschrift/.test(
        labelValue.label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      ) &&
      typeof labelValue.value === 'string' &&
      labelValue.value.trim()
    );
    return typeof captionLabel?.value === 'string' ? captionLabel.value : '';
  }

  private getPostMediaUris(item: any): string[] {
    const mediaItems = [
      ...(Array.isArray(item.media) ? item.media : []),
      ...(Array.isArray(item.label_values)
        ? item.label_values.flatMap((labelValue: any) =>
            Array.isArray(labelValue.media) ? labelValue.media : []
          )
        : []),
    ];
    return [...new Set(mediaItems
      .map(media => media?.uri)
      .filter((uri): uri is string => typeof uri === 'string' && uri.length > 0))];
  }

  private mergeRelatedMedia(posts: NormalizedPost[], mediaRecords: any[]): void {
    for (const mediaRecord of mediaRecords) {
      const mediaTimestamp = Number(
        mediaRecord.creation_timestamp ?? mediaRecord.media?.[0]?.creation_timestamp
      );
      if (!Number.isFinite(mediaTimestamp)) continue;

      const caption = this.getPostCaption(mediaRecord).trim();
      const candidates = posts
        .map(post => ({
          post,
          distance: Math.abs(post.createdAt.getTime() / 1000 - mediaTimestamp),
        }))
        .filter(({ post, distance }) =>
          distance <= 5 &&
          (!caption || !post.content || post.content.trim() === caption)
        )
        .sort((left, right) => left.distance - right.distance);

      if (!candidates.length || (candidates[1] && candidates[0].distance === candidates[1].distance)) {
        continue;
      }

      const post = candidates[0].post;
      const mediaUrls = [...new Set([
        ...(post.mediaUrls || []),
        ...this.getPostMediaUris(mediaRecord),
      ])];
      if (!mediaUrls.length) continue;

      post.mediaUrls = mediaUrls;
      post.mediaTypes = mediaUrls.map(uri => {
        const matchingMedia = [
          ...(Array.isArray(mediaRecord.media) ? mediaRecord.media : []),
          ...(Array.isArray(mediaRecord.label_values)
            ? mediaRecord.label_values.flatMap((labelValue: any) =>
                Array.isArray(labelValue.media) ? labelValue.media : []
              )
            : []),
        ].find(media => media?.uri === uri);
        return matchingMedia?.media_metadata?.video_metadata ||
          /\.(mp4|mov|webm)(?:$|\?)/i.test(uri) ? 'video' : 'image';
      });
    }
  }

  private removeDuplicateMediaFiles(posts: NormalizedPost[], entries: AdmZip.IZipEntry[]): void {
    const entriesByMediaPath = new Map<string, AdmZip.IZipEntry[]>();
    const entriesByName = new Map<string, AdmZip.IZipEntry>();
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const entryName = entry.entryName.replace(/\\/g, '/');
      entriesByName.set(entryName, entry);
      const mediaIndex = entryName.indexOf('media/');
      if (mediaIndex === -1) continue;
      const mediaPath = entryName.slice(mediaIndex);
      const matches = entriesByMediaPath.get(mediaPath) || [];
      matches.push(entry);
      entriesByMediaPath.set(mediaPath, matches);
    }

    for (const post of posts) {
      const seenUris = new Set<string>();
      const seenHashes = new Set<string>();
      const mediaUrls: string[] = [];
      const mediaTypes: Array<'image' | 'video' | 'none'> = [];

      for (const [index, uri] of (post.mediaUrls || []).entries()) {
        if (seenUris.has(uri)) continue;
        seenUris.add(uri);

        const normalizedUri = uri.replace(/\\/g, '/');
        const matchingEntries = entriesByMediaPath.get(normalizedUri) || [];
        const archiveEntry = entriesByName.get(normalizedUri) ||
          (matchingEntries.length === 1 ? matchingEntries[0] : undefined);
        if (archiveEntry) {
          const digest = createHash('sha256').update(archiveEntry.getData()).digest('hex');
          if (seenHashes.has(digest)) continue;
          seenHashes.add(digest);
        }

        mediaUrls.push(uri);
        mediaTypes.push(post.mediaTypes?.[index] || (
          /\.(mp4|mov|webm)(?:$|\?)/i.test(uri) ? 'video' : 'image'
        ));
      }

      if (mediaUrls.length > 0) {
        post.mediaUrls = mediaUrls;
        post.mediaTypes = mediaTypes;
      }
    }
  }

  private parsePostJSON(data: any, postType: 'post' | 'reel' = 'post'): NormalizedPost[] {
    const posts: NormalizedPost[] = [];

    try {
      const items = Array.isArray(data) ? data : [];

      for (const item of items) {
        const timestamp = Number(item.timestamp ?? item.creation_timestamp ?? item.media?.[0]?.creation_timestamp);
        if (!Number.isFinite(timestamp)) continue;

        const caption = this.getPostCaption(item);
        const mediaUris = this.getPostMediaUris(item);

        const mediaTypes: Array<'image' | 'video'> = mediaUris.map(uri => {
          const media = [
            ...(Array.isArray(item.media) ? item.media : []),
            ...(Array.isArray(item.label_values)
              ? item.label_values.flatMap((labelValue: any) =>
                  Array.isArray(labelValue.media) ? labelValue.media : []
                )
              : []),
          ].find((itemMedia: any) => itemMedia.uri === uri);
          return media?.media_metadata?.video_metadata ||
            /\.(mp4|mov|webm)(?:$|\?)/i.test(uri) ? 'video' : 'image';
        });
        const fallbackId = createHash('sha256')
          .update(`${timestamp}\u0000${mediaUris.join('\u0000')}\u0000${caption}`)
          .digest('hex');
        const post: NormalizedPost = {
          originalPlatformId: String(item.fbid || `ig_${fallbackId}`),
          platform: this.platform,
          postType,
          content: caption || undefined,
          mediaUrls: mediaUris.length > 0 ? mediaUris : undefined,
          mediaTypes: mediaUris.length > 0 ? mediaTypes : undefined,
          createdAt: new Date(timestamp * 1000),
          metrics: {
            likesCount: 0,
            commentsCount: 0,
            sharesCount: 0,
            viewsCount: 0,
          },
          hashtags: caption ? this.extractHashtags(caption) : undefined,
          mentions: caption ? this.extractMentions(caption) : undefined,
          isDeleted: false,
        };
        posts.push(post);
      }
    } catch (error) {
      console.error('Error parsing Instagram post JSON:', error);
    }

    return posts;
  }

  async extractUsers(zipPath: string): Promise<NormalizedUser[]> {
    const zip = ZipExtractor.open(zipPath);
    const users: NormalizedUser[] = [];

    try {
      const entries = zip.getEntries();
      const canonicalProfiles = entries.filter(entry =>
        entry.entryName.endsWith('personal_information/personal_information/personal_information.json')
      );
      const profileFiles = canonicalProfiles.length > 0
        ? canonicalProfiles
        : entries.filter(entry =>
            entry.entryName.includes('personal_information') &&
            entry.entryName.endsWith('personal_information.json')
          );

      for (const entry of profileFiles) {
        const content = entry.getData().toString('utf8');
        const data = fixMetaEncoding(JSON.parse(content));
        const profile = Array.isArray(data.profile_user) ? data.profile_user[0] : undefined;
        const stringMap = profile?.string_map_data || {};
        const username = stringMap.Username?.value || data.profile_user_name || data.username;
        const displayName = stringMap.Name?.value || data.profile_name || data.name;
        const bio = stringMap.Bio?.value || data.profile_bio || data.bio;

        const user: NormalizedUser = {
          originalPlatformId: username || 'unknown',
          platform: this.platform,
          username: username || 'unknown',
          displayName: displayName || undefined,
          bio: bio || undefined,
          profilePictureUrl: undefined,
          followersCount: 0,
          followingCount: 0,
          postsCount: 0,
          verified: false,
          joinedAt: undefined,
        };
        users.push(user);
      }
    } catch (error) {
      console.error('Error extracting Instagram users:', error);
    }

    return users;
  }

  async extractFollowRelations(zipPath: string): Promise<NormalizedFollowRelation[]> {
    const zip = ZipExtractor.open(zipPath);
    const relations: NormalizedFollowRelation[] = [];

    try {
      const entries = zip.getEntries();
      const followFiles = entries.filter(entry =>
        entry.entryName.includes('connections/followers_and_following/following') &&
        entry.entryName.endsWith('.json')
      );

      for (const entry of followFiles) {
        const content = entry.getData().toString('utf8');
        const data = fixMetaEncoding(JSON.parse(content));

        const followList = Array.isArray(data) ? data : data.relationships_following || data.following || [];
        const items = Array.isArray(followList) ? followList : [];

        for (const item of items) {
          const username = this.getRelationshipUsername(item);
          if (!username) continue;
          const timestamp = item.string_list_data?.[0]?.timestamp;

          relations.push({
            followerId: 'me',
            followingId: username,
            platform: this.platform,
            followedAt: timestamp ? new Date(timestamp * 1000) : undefined,
          });
        }
      }

      // Also extract followers
      const followerFiles = entries.filter(entry =>
        entry.entryName.includes('connections/followers_and_following/followers') &&
        entry.entryName.endsWith('.json')
      );

      for (const entry of followerFiles) {
        const content = entry.getData().toString('utf8');
        const data = fixMetaEncoding(JSON.parse(content));

        const followerList = Array.isArray(data) ? data : data.relationships_followers || data.followers || [];
        const items = Array.isArray(followerList) ? followerList : [];

        for (const item of items) {
          const username = this.getRelationshipUsername(item);
          if (!username) continue;
          const timestamp = item.string_list_data?.[0]?.timestamp;

          relations.push({
            followerId: username,
            followingId: 'me',
            platform: this.platform,
            followedAt: timestamp ? new Date(timestamp * 1000) : undefined,
          });
        }
      }
    } catch (error) {
      console.error('Error extracting Instagram follow relations:', error);
    }

    return relations;
  }

  async extractLikes(zipPath: string): Promise<NormalizedLike[]> {
    const zip = ZipExtractor.open(zipPath);
    const likes: NormalizedLike[] = [];

    try {
      const entries = zip.getEntries();
      const likeFiles = entries.filter(entry =>
        entry.entryName.includes('your_instagram_activity/likes/liked_posts') &&
        entry.entryName.endsWith('.json')
      );

      for (const entry of likeFiles) {
        const content = entry.getData().toString('utf8');
        const data = fixMetaEncoding(JSON.parse(content));

        const items = Array.isArray(data) ? data : [];

        for (const item of items) {
          let postUrl = '';
          let postText = '';

          if (item.label_values && Array.isArray(item.label_values)) {
            for (const labelValue of item.label_values) {
              if (labelValue.label === 'URL' && typeof labelValue.href === 'string') {
                postUrl = labelValue.href;
              } else if (labelValue.label === 'URL' && typeof labelValue.value === 'string') {
                postUrl = labelValue.value;
              }
              if (CAPTION_LABELS.has(labelValue.label) && typeof labelValue.value === 'string' && !postText) {
                postText = labelValue.value;
              }
            }
          }

          const postIdMatch = postUrl.match(/\/(?:reel|p|tv)\/([^/?#]+)/i);
          const postShortcode = postIdMatch?.[1];
          const postId = item.fbid ? String(item.fbid) : postShortcode || postUrl;
          if (!postId) continue;

          likes.push({
            userId: 'me',
            postId,
            platform: this.platform,
            likedAt: typeof item.timestamp === 'number' ? new Date(item.timestamp * 1000) : undefined,
            postUrl: postUrl || undefined,
            postText: postText || undefined,
            postShortcode,
          });
        }
      }

      likes.push(...this.parseStoryReactions(entries));
    } catch (error) {
      console.error('Error extracting Instagram likes:', error);
    }

    return likes;
  }

  // Likes and emoji reactions on other accounts' stories. The fbid is the story's media
  // ID, so a reaction matches the exact story when its owner uploads their archive.
  private parseStoryReactions(entries: AdmZip.IZipEntry[]): NormalizedLike[] {
    const reactionFiles = entries.filter(entry =>
      /your_instagram_activity\/story_interactions\/(?:story_likes|emoji_story_reactions)\.json$/i
        .test(entry.entryName.replace(/\\/g, '/')) &&
      !entry.entryName.includes('/__MACOSX/') &&
      !path.basename(entry.entryName).startsWith('._')
    );
    return reactionFiles.flatMap(entry => {
      const data = fixMetaEncoding(JSON.parse(entry.getData().toString('utf8')));
      const items = Array.isArray(data) ? data : [];
      return items.flatMap((item: any): NormalizedLike[] => {
        const urlLabel = Array.isArray(item?.label_values)
          ? item.label_values.find((labelValue: any) => labelValue?.label === 'URL')
          : undefined;
        const postUrl = typeof urlLabel?.href === 'string' ? urlLabel.href : urlLabel?.value;
        const storyMatch = typeof postUrl === 'string' ? postUrl.match(STORY_URL_PATTERN) : null;
        const postId = item?.fbid ? String(item.fbid) : storyMatch?.[2];
        if (!postId) return [];
        return [{
          userId: 'me',
          postId,
          platform: this.platform,
          likedAt: typeof item.timestamp === 'number' ? new Date(item.timestamp * 1000) : undefined,
          postUrl: postUrl || undefined,
          postOwnerId: storyMatch?.[1],
        }];
      });
    });
  }

  async extractComments(zipPath: string): Promise<NormalizedComment[]> {
    const zip = ZipExtractor.open(zipPath);
    const comments: NormalizedComment[] = [];

    try {
      const entries = zip.getEntries();
      const commentFiles = entries.filter(entry =>
        entry.entryName.includes('your_instagram_activity/comments') &&
        entry.entryName.endsWith('.json') &&
        !entry.entryName.includes('/__MACOSX/') &&
        !path.basename(entry.entryName).startsWith('._')
      );

      for (const entry of commentFiles) {
        const content = entry.getData().toString('utf8');
        const data = fixMetaEncoding(JSON.parse(content));

        const commentList = Array.isArray(data) ? data : data.comments;
        const items = Array.isArray(commentList) ? commentList : [];

        for (const item of items) {
          const stringMap = item.string_map_data || {};
          const comment = stringMap.Comment?.value ?? item.comment ?? item.text;
          const timestamp = stringMap.Time?.timestamp ?? item.timestamp;
          if (typeof comment !== 'string' || !comment.trim() || typeof timestamp !== 'number') continue;

          comments.push({
            originalPlatformId: item.id || `ig_comment_${timestamp}_${comments.length}`,
            platform: this.platform,
            postId: item.post_id || '',
            postOwnerId: stringMap['Media Owner']?.value || item.post_owner || undefined,
            userId: item.username || item.user || 'me',
            content: comment,
            createdAt: new Date(timestamp * 1000),
            likesCount: item.like_count || 0,
          });
        }
      }
    } catch (error) {
      console.error('Error extracting Instagram comments:', error);
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
