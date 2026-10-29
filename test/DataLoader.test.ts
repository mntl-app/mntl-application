import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FacebookAdapter, facebookOwnerFromTitle, facebookOwnerFromUrl } from '../src/adapters/facebook/FacebookAdapter';
import { InstagramAdapter } from '../src/adapters/instagram/InstagramAdapter';
import { TikTokAdapter } from '../src/adapters/tiktok/TikTokAdapter';
import { TikTokMediaDownloader } from '../src/adapters/tiktok/TikTokMediaDownloader';
import { XAdapter } from '../src/adapters/x/XAdapter';
import { getSessionUserId, getSessionUserIds, setSessionUser } from '../src/api/session';
import { extractPostMedia, storedMediaPath } from '../src/etl/extract/MediaExtractor';
import { ArchiveStore, compareArchives, StoredArchive } from '../src/etl/load/ArchiveStore';
import { InMemoryDataLoader } from '../src/etl/load/DataLoader';
import { clearDevelopmentArchives } from '../src/etl/load/DevelopmentArchiveCleanup';
import { MntlUserStore } from '../src/etl/load/MntlUserStore';
import { identityKey, minimizeLike } from '../src/etl/load/Identity';
import { OptOutStore } from '../src/etl/load/OptOutStore';
import { LikeSchema, PostSchema } from '../src/types/schemas';

process.env.FINGERPRINT_SECRET = 'test-fingerprint-secret';

function createPost(originalPlatformId: string, content: string) {
  return PostSchema.parse({
    originalPlatformId,
    platform: 'instagram',
    content,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

function createLike(postId: string, postText?: string) {
  return LikeSchema.parse({
    userId: 'owner-1',
    postId,
    platform: 'instagram',
    postText,
  });
}

test('clears stored archives and uploaded ZIPs only for development startup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'development-archive-cleanup-test-'));
  const uploads = join(directory, 'uploads');
  const mntlUsers = join(directory, 'data', 'mntl-users.json');
  const archives = join(directory, 'data', 'archives');
  const media = join(directory, 'data', 'media');
  mkdirSync(uploads);
  mkdirSync(join(directory, 'data'), { recursive: true });
  mkdirSync(archives, { recursive: true });
  mkdirSync(join(media, 'b'.repeat(32)), { recursive: true });
  mkdirSync(join(media, 'keep-me'), { recursive: true });
  writeFileSync(join(uploads, 'a'.repeat(32)), 'uploaded ZIP');
  writeFileSync(join(uploads, 'keep-me.txt'), 'unrelated upload file');
  writeFileSync(mntlUsers, 'prototype MNTL profiles');
  writeFileSync(join(archives, 'archive-1.json'), 'stored archive');
  writeFileSync(join(archives, 'archive-1.json.123.tmp'), 'temporary archive');
  writeFileSync(join(archives, 'keep-me.txt'), 'unrelated file');
  writeFileSync(join(media, 'b'.repeat(32), 'video-0.mp4'), 'downloaded video');
  writeFileSync(join(media, 'keep-me', 'video.mp4'), 'unrelated video');

  try {
    assert.equal(await clearDevelopmentArchives(directory, 'production'), 0);
    assert.equal(existsSync(join(archives, 'archive-1.json')), true);

    assert.equal(await clearDevelopmentArchives(directory, 'development'), 5);
    assert.equal(existsSync(join(uploads, 'a'.repeat(32))), false);
    assert.equal(existsSync(mntlUsers), false);
    assert.equal(existsSync(join(archives, 'archive-1.json')), false);
    assert.equal(existsSync(join(archives, 'archive-1.json.123.tmp')), false);
    assert.equal(existsSync(join(media, 'b'.repeat(32))), false);
    assert.equal(existsSync(join(media, 'keep-me', 'video.mp4')), true);
    assert.equal(readFileSync(join(uploads, 'keep-me.txt'), 'utf8'), 'unrelated upload file');
    assert.equal(readFileSync(join(archives, 'keep-me.txt'), 'utf8'), 'unrelated file');
    assert.equal(existsSync(uploads), true);
    assert.equal(existsSync(archives), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('extracts TikTok posts, account, followers, and following but not activity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiktok-archive-test-'));
  const archivePath = join(directory, 'archive.zip');
  const zip = new AdmZip();
  const archiveData = {
    Post: {
      Posts: {
        VideoList: [{
          Date: '2026-10-20 18:30:00',
          Link: 'https://video-useastred.tiktokv.eu/storage/v1/video-resource?signature=secret',
          Likes: '19',
          Title: 'My posted video',
          description: 'My posted video',
          Location: 'Example city',
        }],
      },
    },
    'Profile And Settings': {
      'Profile Info': {
        ProfileMap: {
          userName: 'creator_handle',
          displayName: 'Creator',
          bioDescription: 'Creator profile',
          followerCount: 11,
          followingCount: 66,
        },
      },
      Follower: { FansList: [{ UserName: 'follower_handle', Date: '2026-10-01 00:00:00' }] },
      Following: { Following: [{ UserName: 'following_handle', Date: '2026-10-02 00:00:00' }] },
    },
    'Likes and Favorites': {
      'Like List': {
        ItemFavoriteList: [{
          date: '2026-10-03 00:00:00',
          link: 'https://www.tiktokv.com/share/video/7675674338401602849/',
        }],
      },
    },
    Comment: {
      Comments: {
        CommentsList: [{
          CommentID: 'comment-1',
          comment: 'A comment from this account',
          date: '2026-10-05 12:00:00 UTC',
          originalPostUrl: 'https://www.tiktok.com/@creator/video/7675674338401602849',
        }],
      },
    },
    'Your Activity': {
      'Watch History': {
        VideoList: [{
          Link: 'https://video-useastred.tiktokv.eu/storage/v1/someone-elses-video',
          Date: '2026-10-04T00:00:00.000Z',
          Title: 'A watched video',
        }],
      },
    },
  };
  zip.addFile('user_data_tiktok.json', Buffer.from(JSON.stringify(archiveData)));
  zip.writeZip(archivePath);

  try {
    const adapter = new TikTokAdapter();
    assert.equal(adapter.detect(zip.getEntries().map(entry => entry.entryName)), true);
    const posts = await adapter.extractPosts(archivePath);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].platform, 'tiktok');
    assert.equal(posts[0].postType, 'reel');
    assert.equal(posts[0].content, 'My posted video');
    assert.equal(posts[0].metrics?.likesCount, 19);
    assert.match(posts[0].originalPlatformId, /^tt_[a-f0-9]{24}$/);

    const [user] = await adapter.extractUsers(archivePath);
    assert.equal(user.username, 'creator_handle');
    assert.equal(user.displayName, 'Creator');
    assert.equal(user.followersCount, 11);
    assert.equal(user.followingCount, 66);

    const relations = await adapter.extractFollowRelations(archivePath);
    assert.deepEqual(
      relations.map(({ followerId, followingId }) => [followerId, followingId]),
      [
        ['me', 'following_handle'],
        ['follower_handle', 'me'],
      ]
    );

    assert.deepEqual(await adapter.extractLikes(archivePath), []);
    assert.deepEqual(await adapter.extractComments(archivePath), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('downloads only allowlisted TikTok video links into archive media storage', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiktok-video-download-test-'));
  const archiveId = 'a'.repeat(32);
  let fetchCount = 0;
  const downloader = new TikTokMediaDownloader(directory, async input => {
    fetchCount++;
    assert.equal(new URL(String(input)).hostname, 'video-useastred.tiktokv.eu');
    return new Response(Buffer.from('video-content'), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    });
  });
  const post = PostSchema.parse({
    originalPlatformId: 'tt_video',
    platform: 'tiktok',
    postType: 'reel',
    mediaUrls: ['https://video-useastred.tiktokv.eu/storage/video?signature=hidden'],
    mediaTypes: ['video'],
    createdAt: new Date('2026-10-20T18:30:00.000Z'),
  });

  try {
    const [downloaded] = await downloader.downloadOwnPostedVideos([post], archiveId);
    assert.equal(fetchCount, 1);
    assert.deepEqual(downloaded.mediaUrls, ['media/tiktok/video-0.mp4']);
    assert.equal(
      readFileSync(join(directory, archiveId, 'video-0.mp4'), 'utf8'),
      'video-content'
    );

    const rejectedDownloader = new TikTokMediaDownloader(join(directory, 'rejected'), async () => {
      throw new Error('Unapproved host should not be fetched');
    });
    await assert.rejects(
      rejectedDownloader.downloadOwnPostedVideos([{
        ...post,
        mediaUrls: ['https://example.com/video.mp4'],
      }], 'b'.repeat(32)),
      /approved HTTPS host/
    );

    const redirectDownloader = new TikTokMediaDownloader(join(directory, 'redirected'), async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/private-resource' },
      })
    );
    await assert.rejects(
      redirectDownloader.downloadOwnPostedVideos([post], 'c'.repeat(32)),
      /approved HTTPS host/
    );

    const timeoutDownloader = new TikTokMediaDownloader(join(directory, 'timeout'), async () => {
      throw new DOMException('The operation was aborted', 'AbortError');
    });
    const [postWithRemoteUrl] = await timeoutDownloader.downloadOwnPostedVideos([post], 'd'.repeat(32));
    assert.deepEqual(postWithRemoteUrl.mediaUrls, post.mediaUrls);
    assert.equal(
      existsSync(join(directory, 'timeout', 'd'.repeat(32), 'video-0.mp4')),
      false
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('resolves stored likes when a matching post arrives later by exact caption', async () => {
  const loader = new InMemoryDataLoader();
  await loader.saveLikes([createLike('shortcode-1', 'Hello   world')]);

  assert.equal(loader.getLikeMatches()[0].matchedPost, null);

  await loader.savePosts([createPost('native-post-id', ' hello world ')]);
  const [match] = loader.getLikeMatches();

  assert.equal(match.matchType, 'text');
  assert.equal(match.matchedPost?.originalPlatformId, 'native-post-id');
});

test('prefers a platform post ID match over caption matching', async () => {
  const loader = new InMemoryDataLoader();
  const byId = createPost('shortcode-1', 'Different caption');
  await loader.savePosts([byId]);
  await loader.saveLikes([createLike('shortcode-1', 'Hello world')]);

  const [match] = loader.getLikeMatches();
  assert.equal(match.matchType, 'id');
  assert.equal(match.matchedPost?.originalPlatformId, 'shortcode-1');
});

test('does not guess when multiple posts have the same caption', async () => {
  const loader = new InMemoryDataLoader();
  await loader.savePosts([
    createPost('post-1', 'Same caption'),
    createPost('post-2', 'same   caption'),
  ]);
  await loader.saveLikes([createLike('unknown-shortcode', 'SAME CAPTION')]);

  const [match] = loader.getLikeMatches();
  assert.equal(match.matchType, null);
  assert.equal(match.matchedPost, null);
});

test('matches likes and comments across TikTok archives by direct video ID', () => {
  const postId = '7661981101627280672';
  const current: StoredArchive = {
    archiveId: 'current',
    ownerId: 'sofiefant',
    platform: 'tiktok',
    importedAt: '2026-10-26T00:00:00.000Z',
    followers: [],
    following: [],
    posts: [],
    likes: [{
      userId: 'sofiefant',
      postId,
      platform: 'tiktok',
      postUrl: `https://www.tiktokv.com/share/video/${postId}/`,
      likedAt: new Date('2026-10-26T18:07:25.000Z'),
    }],
  };
  const other: StoredArchive = {
    archiveId: 'other',
    ownerId: 'rgbanana8',
    platform: 'tiktok',
    importedAt: '2026-10-26T00:00:00.000Z',
    followers: [],
    following: [],
    posts: [],
    likes: [],
    comments: [{
      originalPlatformId: 'comment-1',
      platform: 'tiktok',
      postId,
      postOwnerId: '7648949224730838048',
      postUrl: `https://www.tiktok.com/@7648949224730838048/video/${postId}`,
      userId: 'me',
      content: '🥰',
      createdAt: new Date('2026-10-26T18:07:25.000Z'),
      likesCount: 0,
    }],
  };

  const [match] = compareArchives(current, other).sharedPostInteractions;
  assert.equal(match.postId, postId);
  assert.deepEqual(match.current.map(interaction => interaction.type), ['like']);
  assert.deepEqual(match.other.map(interaction => interaction.type), ['comment']);
  // The other user's comment text is not shared through comparisons.
  assert.equal(match.other[0].content, undefined);
});

test('does not detect a platform from generic post, comment, data, or video names', () => {
  assert.equal(new InstagramAdapter().detect(['posts.json', 'media/posts/image.jpg']), false);
  assert.equal(new FacebookAdapter().detect(['comments.json']), false);
  assert.equal(new XAdapter().detect(['data/export.json']), false);
  assert.equal(new TikTokAdapter().detect(['video.json']), false);
});

test('keeps Instagram liked-post FBIDs separate from URL shortcodes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'instagram-adapter-test-'));
  const archivePath = join(directory, 'archive.zip');
  const zip = new AdmZip();
  zip.addFile(
    'your_instagram_activity/likes/liked_posts.json',
    Buffer.from(JSON.stringify([{
      fbid: 'post-fbid-123',
      timestamp: 1700000000,
      label_values: [{
        label: 'URL',
        href: 'https://www.instagram.com/reel/shortcode-456/',
      }],
    }]))
  );
  zip.writeZip(archivePath);

  try {
    const [like] = await new InstagramAdapter().extractLikes(archivePath);
    assert.equal(like.postId, 'post-fbid-123');
    assert.equal(like.postShortcode, 'shortcode-456');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('extracts X posts, media categories, followers, following, and likes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'x-adapter-test-'));
  const archivePath = join(directory, 'archive.zip');
  const zip = new AdmZip();
  zip.addFile(
    'data/tweets.js',
    Buffer.from(`window.YTD.tweets.part0 = ${JSON.stringify([
      { tweet: {
        id_str: 'tweet-photo',
        created_at: 'Sat Oct 24 23:56:41 +0000 2026',
        full_text: 'Photo with a caption',
        entities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/photo.jpg' }] },
      } },
      { tweet: {
        id_str: 'tweet-video',
        created_at: 'Sat Oct 24 23:56:42 +0000 2026',
        full_text: 'Video caption',
        extended_entities: { media: [{ type: 'video', media_url_https: 'https://pbs.twimg.com/media/clip.mp4' }] },
      } },
      { tweet: {
        id_str: 'tweet-text',
        created_at: 'Sat Oct 24 23:56:43 +0000 2026',
        full_text: 'Text-only [post]',
      } },
      { tweet: {
        id_str: 'tweet-reply',
        created_at: 'Sat Oct 24 23:56:44 +0000 2026',
        full_text: 'Reply to another post',
        in_reply_to_status_id_str: 'parent-tweet',
      } },
    ])};`)
  );
  zip.addFile('data/tweets_media/tweet-photo-photo.jpg', Buffer.from('photo'));
  zip.addFile('data/tweets_media/tweet-video-clip.mp4', Buffer.from('video'));
  zip.addFile(
    'data/account.js',
    Buffer.from(`window.YTD.account.part0 = ${JSON.stringify([{
      account: {
        accountId: 'owner-id',
        username: 'owner',
        accountDisplayName: 'Account Owner',
        createdAt: '2020-07-22T13:26:29.641Z',
      },
    }])};`)
  );
  zip.addFile(
    'data/follower.js',
    Buffer.from(`window.YTD.follower.part0 = ${JSON.stringify([{ follower: { accountId: 'follower-id' } }])};`)
  );
  zip.addFile(
    'data/following.js',
    Buffer.from(`window.YTD.following.part0 = ${JSON.stringify([{ following: { accountId: 'following-id' } }])};`)
  );
  zip.addFile(
    'data/like.js',
    Buffer.from(`window.YTD.like.part0 = ${JSON.stringify([{
      like: {
        tweetId: 'liked-tweet-id',
        fullText: 'A liked tweet',
        expandedUrl: 'https://twitter.com/i/web/status/liked-tweet-id',
      },
    }])};`)
  );
  zip.writeZip(archivePath);

  try {
    const adapter = new XAdapter();
    assert.equal(adapter.detect(zip.getEntries().map(entry => entry.entryName)), true);

    const posts = await adapter.extractPosts(archivePath);
    assert.equal(posts.length, 4);
    assert.equal(posts[0].postType, 'post');
    assert.equal(posts[0].isReply, undefined);
    assert.deepEqual(posts[0].mediaUrls, ['data/tweets_media/tweet-photo-photo.jpg']);
    assert.equal(posts[0].mediaTypes?.[0], 'image');
    assert.equal(posts[1].postType, 'reel');
    assert.deepEqual(posts[1].mediaUrls, ['data/tweets_media/tweet-video-clip.mp4']);
    assert.equal(posts[1].mediaTypes?.[0], 'video');
    assert.equal(posts[2].postType, 'text');
    assert.equal(posts[2].content, 'Text-only [post]');
    assert.equal(posts[3].postType, 'text');
    assert.equal(posts[3].isReply, true);
    assert.equal(posts[3].replyToPostId, 'parent-tweet');

    const [user] = await adapter.extractUsers(archivePath);
    assert.equal(user.originalPlatformId, 'owner-id');
    assert.equal(user.username, 'owner');
    assert.equal(user.displayName, 'Account Owner');

    const relations = await adapter.extractFollowRelations(archivePath);
    assert.deepEqual(relations.map(relation => [relation.followerId, relation.followingId]), [
      ['follower-id', 'me'],
      ['me', 'following-id'],
    ]);

    const [like] = await adapter.extractLikes(archivePath);
    assert.equal(like.userId, 'me');
    assert.equal(like.postId, 'liked-tweet-id');
    assert.equal(like.postText, 'A liked tweet');
    assert.equal(like.postUrl, 'https://twitter.com/i/web/status/liked-tweet-id');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('joins carousel media records to posts with localized media and caption labels', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'instagram-carousel-test-'));
  const archivePath = join(directory, 'archive.zip');
  const zip = new AdmZip();
  zip.addFile(
    'instagram-export/your_instagram_activity/media/posts.json',
    Buffer.from(JSON.stringify([{
      timestamp: 1700000000,
      fbid: 'post-fbid-carousel',
      label_values: [
        { label: 'Légende', value: 'An album caption' },
        {
          label: 'Contenu multimédia',
          media: [{
            uri: 'media/posts/cover.jpg',
            creation_timestamp: 1700000000,
          }],
        },
      ],
    }]))
  );
  zip.addFile(
    'instagram-export/your_instagram_activity/media/posts_1.json',
    Buffer.from(JSON.stringify([{
      title: 'An album caption',
      media: [
        { uri: 'media/posts/photo-1.jpg', creation_timestamp: 1700000001 },
        { uri: 'media/posts/photo-2.jpg', creation_timestamp: 1700000001 },
      ],
    }]))
  );
  zip.addFile('instagram-export/media/posts/cover.jpg', Buffer.from('same-image'));
  zip.addFile('instagram-export/media/posts/photo-1.jpg', Buffer.from('same-image'));
  zip.addFile('instagram-export/media/posts/photo-2.jpg', Buffer.from('another-image'));
  zip.writeZip(archivePath);

  try {
    const [post] = await new InstagramAdapter().extractPosts(archivePath);
    assert.equal(post.originalPlatformId, 'post-fbid-carousel');
    assert.equal(post.postType, 'post');
    assert.equal(post.content, 'An album caption');
    assert.deepEqual(post.mediaUrls, [
      'media/posts/cover.jpg',
      'media/posts/photo-2.jpg',
    ]);
    assert.deepEqual(post.mediaTypes, ['image', 'image']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('extracts Instagram reels, captions, and bundled video media', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'instagram-reels-test-'));
  const archivePath = join(directory, 'archive.zip');
  const zip = new AdmZip();
  zip.addFile(
    'export/your_instagram_activity/media/reels.json',
    Buffer.from(JSON.stringify({
      ig_reels_media: [{
        media: [{
          uri: 'media/reels/202608/reel-101.mp4',
          creation_timestamp: 1787862017,
          title: 'A reel caption',
          media_metadata: { video_metadata: {} },
        }],
      }],
    }))
  );
  zip.addFile('export/media/reels/202608/reel-101.mp4', Buffer.from('reel-video'));
  zip.addFile(
    'export/__MACOSX/your_instagram_activity/media/._reels.json',
    Buffer.from('not-json')
  );
  zip.writeZip(archivePath);

  try {
    const [reel] = await new InstagramAdapter().extractPosts(archivePath);
    assert.equal(reel.postType, 'reel');
    assert.equal(reel.content, 'A reel caption');
    assert.deepEqual(reel.mediaUrls, ['media/reels/202608/reel-101.mp4']);
    assert.deepEqual(reel.mediaTypes, ['video']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('extracts follower and following arrays with the correct direction', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'instagram-follow-test-'));
  const archivePath = join(directory, 'archive.zip');
  const zip = new AdmZip();
  zip.addFile(
    'connections/followers_and_following/followers_1.json',
    Buffer.from(JSON.stringify([
      {
        title: '',
        string_list_data: [{
          href: 'https://www.instagram.com/follower-account/',
          value: 'follower-account',
          timestamp: 1700000000,
        }],
      },
    ]))
  );
  zip.addFile(
    'connections/followers_and_following/following.json',
    Buffer.from(JSON.stringify({
      relationships_following: [
        { title: 'following-account', string_list_data: [{ timestamp: 1700000000 }] },
      ],
    }))
  );
  zip.writeZip(archivePath);

  try {
    const relations = await new InstagramAdapter().extractFollowRelations(archivePath);
    assert.deepEqual(
      relations.map(({ followerId, followingId }) => ({ followerId, followingId })),
      [
        { followerId: 'me', followingId: 'following-account' },
        { followerId: 'follower-account', followingId: 'me' },
      ]
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('persists account archives and matches relationships and likes across accounts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'archive-store-test-'));
  const store = new ArchiveStore(directory);
  const alicePost = createPost('alice-post-id', 'Alice post caption');
  alicePost.mediaUrls = ['/api/media?entry=alice-photo.jpg'];
  alicePost.mediaTypes = ['image'];
  const bobPost = createPost('bob-post-id', 'Bob post caption');
  bobPost.mediaUrls = ['/api/media?entry=bob-photo.jpg'];
  bobPost.mediaTypes = ['image'];
  const alice: StoredArchive = {
    archiveId: 'alice-archive',
    ownerId: 'alice',
    platform: 'instagram',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: ['bob', 'common-follower'],
    following: ['bob', 'common-following'],
    posts: [alicePost],
    likes: [
      createLike('bob-post-id'),
      createLike('legacy-id', 'Bob post caption'),
    ],
    comments: [{
      originalPlatformId: 'alice-comment-id',
      platform: 'instagram',
      postId: 'bob-post-id',
      userId: 'alice',
      content: 'Alice comment',
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
      likesCount: 2,
    }],
  };
  const bob: StoredArchive = {
    archiveId: 'bob-archive',
    ownerId: 'bob',
    platform: 'instagram',
    importedAt: '2026-01-02T00:00:00.000Z',
    followers: ['alice', 'common-follower'],
    following: ['alice', 'common-following'],
    posts: [bobPost],
    likes: [createLike('alice-post-id')],
  };

  try {
    await store.save(alice);
    await store.save(bob);

    const loaded = await store.get('alice-archive');
    assert.equal(loaded?.ownerId, 'alice');
    assert.equal(loaded?.posts[0].content, 'Alice post caption');
    assert.equal(loaded?.comments?.[0].content, 'Alice comment');
    assert.equal((await store.list()).length, 2);

    const [comparison] = await store.compare('alice-archive');
    assert.equal(comparison.ownerId, 'bob');
    assert.equal(comparison.follows, 'mutual');
    assert.equal(comparison.youFollowThem, true);
    assert.equal(comparison.theyFollowYou, true);
    assert.equal(comparison.sharedFollowingCount, 1);
    assert.equal(comparison.sharedFollowersCount, 1);
    assert.deepEqual(
      comparison.likesOnTheirPosts.map(match => match.matchType),
      ['id', 'text']
    );
    assert.equal(comparison.theyLikeYourPosts[0].matchType, 'id');
    assert.deepEqual(comparison.theyLikeYourPosts[0].mediaUrls, ['/api/media?entry=alice-photo.jpg']);
    assert.deepEqual(comparison.theyLikeYourPosts[0].mediaTypes, ['image']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('creates unique prototype MNTL handles without case-sensitive duplicates', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mntl-user-store-test-'));
  const store = new MntlUserStore(join(directory, 'mntl-users.json'));

  try {
    const user = await store.create('mntl_user1');
    assert.equal(user.handle, 'mntl_user1');
    assert.equal((await store.getById(user.userId))?.normalizedHandle, 'mntl_user1');
    await assert.rejects(store.create('MNTL_USER1'), /already taken/);
    await assert.rejects(store.create('bad-handle'), /3-30 characters/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('aggregates cross-platform archive matches into one MNTL connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mntl-connections-test-'));
  const store = new ArchiveStore(directory);
  const archives: StoredArchive[] = [
    {
      archiveId: 'alice-instagram',
      ownerId: 'alice_ig',
      ownerHandle: 'alice_ig',
      mntlUserId: 'alice-id',
      mntlHandle: 'mntl_alice',
      platform: 'instagram',
      importedAt: '2026-01-01T00:00:00.000Z',
      followers: [],
      following: ['bob_ig'],
      posts: [],
      likes: [],
    },
    {
      archiveId: 'alice-x',
      ownerId: '1001',
      ownerHandle: 'alice_x',
      mntlUserId: 'alice-id',
      mntlHandle: 'mntl_alice',
      platform: 'x',
      importedAt: '2026-01-02T00:00:00.000Z',
      followers: [],
      following: ['2002'],
      posts: [],
      likes: [],
    },
    {
      archiveId: 'bob-instagram',
      ownerId: 'bob_ig',
      ownerHandle: 'bob_ig',
      mntlUserId: 'bob-id',
      mntlHandle: 'mntl_bob',
      platform: 'instagram',
      importedAt: '2026-01-03T00:00:00.000Z',
      followers: ['alice_ig'],
      following: ['alice_ig'],
      posts: [],
      likes: [],
    },
    {
      archiveId: 'bob-x',
      ownerId: '2002',
      ownerHandle: 'bob_x',
      mntlUserId: 'bob-id',
      mntlHandle: 'mntl_bob',
      platform: 'x',
      importedAt: '2026-01-04T00:00:00.000Z',
      followers: ['1001'],
      following: ['1001'],
      posts: [],
      likes: [],
    },
  ];

  try {
    for (const archive of archives) await store.save(archive);
    for (const archive of archives) {
      await store.saveSelection(archive.archiveId, {
        postIds: [],
        followers: archive.followers,
        following: archive.following,
      });
    }
    assert.deepEqual(await store.getMntlConnections('alice-id'), [{
      mntlUserId: 'bob-id',
      mntlHandle: 'mntl_bob',
      platforms: [
        { platform: 'instagram', youFollowThem: true, theyFollowYou: true },
        { platform: 'x', youFollowThem: true, theyFollowYou: true },
      ],
    }]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('shows matched third-party activity before MNTL verification', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'verified-activity-test-'));
  const store = new ArchiveStore(directory);
  const alice: StoredArchive = {
    archiveId: 'alice-instagram-verified',
    ownerId: 'alice_ig',
    ownerHandle: 'alice_ig',
    mntlUserId: 'alice-id',
    mntlHandle: 'mntl_alice',
    platform: 'instagram',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: [],
    following: ['bob_ig'],
    posts: [],
    likes: [LikeSchema.parse({
      userId: 'alice_ig',
      postId: 'bob-post',
      platform: 'instagram',
      likedAt: new Date('2026-01-02T00:00:00.000Z'),
    })],
  };
  const bob: StoredArchive = {
    archiveId: 'bob-instagram-verified',
    ownerId: 'bob_ig',
    ownerHandle: 'bob_ig',
    mntlUserId: 'bob-id',
    mntlHandle: 'mntl_bob',
    platform: 'instagram',
    importedAt: '2026-01-03T00:00:00.000Z',
    followers: [],
    following: [],
    posts: [{
      ...createPost('bob-post', 'Bob’s shared post'),
      mediaUrls: ['/api/media?entry=bob.jpg'],
      mediaTypes: ['image'],
    }],
    likes: [],
  };

  try {
    await store.save(alice);
    await store.save(bob);
    await store.saveSelection(alice.archiveId, {
      postIds: [],
      followers: [],
      following: ['bob_ig'],
    });
    const [activity] = await store.getMntlActivities('alice-id');
    assert.equal(activity.type, 'like');
    assert.equal(activity.target.ownerHandle, 'mntl_bob');
    assert.equal(activity.target.text, 'Bob’s shared post');
    assert.deepEqual(activity.target.mediaUrls, ['/api/media?entry=bob.jpg']);
    assert.deepEqual(await store.getMntlConnections('alice-id'), [{
      mntlUserId: 'bob-id',
      mntlHandle: 'mntl_bob',
      platforms: [{ platform: 'instagram', youFollowThem: true, theyFollowYou: false }],
    }]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('does not expose legacy TikTok likes or comments as profile activity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiktok-activity-disabled-test-'));
  const store = new ArchiveStore(directory);
  const archive: StoredArchive = {
    archiveId: 'legacy-tiktok-activity',
    ownerId: 'alice_tiktok',
    ownerHandle: 'alice_tiktok',
    mntlUserId: 'alice-id',
    mntlHandle: 'mntl_alice',
    platform: 'tiktok',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: [],
    following: [],
    posts: [],
    likes: [LikeSchema.parse({
      userId: 'alice_tiktok',
      postId: 'video-id',
      platform: 'tiktok',
      likedAt: new Date('2026-01-01T00:00:30.000Z'),
    })],
    comments: [{
      originalPlatformId: 'legacy-comment',
      platform: 'tiktok',
      postId: 'video-id',
      userId: 'alice_tiktok',
      content: 'Legacy comment',
      createdAt: new Date('2026-01-01T00:00:30.000Z'),
      likesCount: 0,
    }],
  };

  try {
    await store.save(archive);
    assert.deepEqual(await store.getMntlActivities('alice-id'), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('shows likes and comments even when their target posts have not been uploaded', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'unmatched-activity-test-'));
  const store = new ArchiveStore(directory);
  const alice: StoredArchive = {
    archiveId: 'alice-instagram-unmatched',
    ownerId: 'alice_ig',
    ownerHandle: 'alice_ig',
    mntlUserId: 'alice-id',
    mntlHandle: 'mntl_alice',
    platform: 'instagram',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: [],
    following: ['bob_ig'],
    posts: [],
    likes: [LikeSchema.parse({
        userId: 'alice_ig',
        postId: 'not-uploaded-yet',
        platform: 'instagram',
        likedAt: new Date('2026-01-02T00:00:00.000Z'),
      })],
    comments: [{
      originalPlatformId: 'comment-not-uploaded-yet',
      platform: 'instagram',
      postId: 'another-post-not-uploaded-yet',
      userId: 'alice_ig',
      content: 'Comment on a post not uploaded yet',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      likesCount: 0,
    }],
  };

  try {
    await store.save(alice);
    const activities = await store.getMntlActivities('alice-id');
    assert.deepEqual(activities.map(activity => activity.type).sort(), ['comment', 'like']);
    assert.ok(activities.every(activity => activity.target.type === 'unknown'));
    assert.ok(activities.every(activity => !activity.target.ownerMntlUserId));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('does not expose discovered connections when a platform identity maps to multiple MNTL profiles', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ambiguous-relationship-claim-test-'));
  const store = new ArchiveStore(directory);
  const alice: StoredArchive = {
    archiveId: 'alice-instagram-ambiguous',
    ownerId: 'alice_ig',
    ownerHandle: 'alice_ig',
    mntlUserId: 'alice-id',
    mntlHandle: 'mntl_alice',
    platform: 'instagram',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: [],
    following: ['bob_ig'],
    posts: [],
    likes: [],
  };
  const bob: StoredArchive = {
    archiveId: 'bob-instagram-ambiguous',
    ownerId: 'bob_ig',
    ownerHandle: 'bob_ig',
    mntlUserId: 'bob-id',
    mntlHandle: 'mntl_bob',
    platform: 'instagram',
    importedAt: '2026-01-02T00:00:00.000Z',
    followers: [],
    following: [],
    posts: [],
    likes: [],
  };
  const duplicate: StoredArchive = {
    ...bob,
    archiveId: 'duplicate-bob-instagram-ambiguous',
    mntlUserId: 'other-id',
    mntlHandle: 'mntl_other',
  };

  try {
    await store.save(alice);
    await store.save(bob);
    await store.save(duplicate);
    await store.saveSelection(alice.archiveId, {
      postIds: [],
      followers: [],
      following: ['bob_ig'],
    });

    assert.deepEqual(await store.getMntlConnections('alice-id'), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('normalizes likes and comments from linked archives into one activity format', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mntl-activity-test-'));
  const store = new ArchiveStore(directory);
  const instagramPost = {
    ...createPost('instagram-post', 'A shared photo'),
    postType: 'post' as const,
  };
  const xPost = PostSchema.parse({
    originalPlatformId: 'x-post',
    platform: 'x',
    postType: 'text',
    content: 'A shared thought',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  const xReel = PostSchema.parse({
    originalPlatformId: 'x-reel',
    platform: 'x',
    postType: 'reel',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  const xReply = PostSchema.parse({
    originalPlatformId: 'x-reply',
    platform: 'x',
    isReply: true,
    replyToPostId: 'x-post',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  try {
    await store.save({
      archiveId: 'alice-instagram-activity',
      ownerId: 'alice_ig',
      ownerHandle: 'alice_ig',
      mntlUserId: 'alice-id',
      mntlHandle: 'mntl_alice',
      platform: 'instagram',
      importedAt: '2026-01-01T00:00:00.000Z',
      followers: [],
      following: [],
      posts: [instagramPost],
      likes: [LikeSchema.parse({
        userId: 'alice_ig',
        postId: 'instagram-post',
        platform: 'instagram',
        likedAt: new Date('2026-01-02T00:00:00.000Z'),
      })],
    });
    await store.save({
      archiveId: 'alice-x-activity',
      ownerId: 'alice_x',
      ownerHandle: 'alice_x',
      mntlUserId: 'alice-id',
      mntlHandle: 'mntl_alice',
      platform: 'x',
      importedAt: '2026-01-03T00:00:00.000Z',
      followers: [],
      following: [],
      posts: [xPost, xReel, xReply],
      likes: [
        LikeSchema.parse({
          userId: 'alice_x',
          postId: 'x-reel',
          platform: 'x',
          likedAt: new Date('2026-01-03T00:00:00.000Z'),
        }),
        LikeSchema.parse({
          userId: 'alice_x',
          postId: 'x-reply',
          platform: 'x',
          likedAt: new Date('2026-01-03T00:00:00.000Z'),
        }),
      ],
      comments: [{
        originalPlatformId: 'x-comment',
        platform: 'x',
        postId: 'x-post',
        userId: 'alice_x',
        content: 'A shared reply',
        createdAt: new Date('2026-01-04T00:00:00.000Z'),
        likesCount: 0,
      }],
    });

    const activities = await store.getMntlActivities('alice-id');
    assert.equal(activities.length, 4);
    assert.deepEqual(activities.map(activity => ({
      type: activity.type,
      platform: activity.platform,
      targetType: activity.target.type,
      targetText: activity.target.text,
      actorId: activity.actor.mntlUserId,
    })), [
      {
        type: 'comment',
        platform: 'x',
        targetType: 'text',
        targetText: 'A shared thought',
        actorId: 'alice-id',
      },
      {
        type: 'like',
        platform: 'x',
        targetType: 'reel',
        targetText: undefined,
        actorId: 'alice-id',
      },
      {
        type: 'like',
        platform: 'x',
        targetType: 'reply',
        targetText: undefined,
        actorId: 'alice-id',
      },
      {
        type: 'like',
        platform: 'instagram',
        targetType: 'post',
        targetText: 'A shared photo',
        actorId: 'alice-id',
      },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('resolves known X account IDs to handles and exposes handles in archive comparisons', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'x-owner-handle-test-'));
  const store = new ArchiveStore(directory);
  const alice: StoredArchive = {
    archiveId: 'alice-x',
    ownerId: '1001',
    ownerHandle: 'alice_handle',
    platform: 'x',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: ['2002', 'unknown-id'],
    following: ['2002'],
    posts: [],
    likes: [],
  };
  const bob: StoredArchive = {
    archiveId: 'bob-x',
    ownerId: '2002',
    ownerHandle: '@bob_handle',
    platform: 'x',
    importedAt: '2026-01-02T00:00:00.000Z',
    followers: ['1001'],
    following: ['1001'],
    posts: [],
    likes: [],
  };
  const anotherPlatform: StoredArchive = {
    archiveId: 'bob-instagram',
    ownerId: '2002',
    ownerHandle: 'wrong_platform_handle',
    platform: 'instagram',
    importedAt: '2026-01-03T00:00:00.000Z',
    followers: [],
    following: [],
    posts: [],
    likes: [],
  };

  try {
    await store.save(alice);
    await store.save(bob);
    await store.save(anotherPlatform);

    const knownHandles = [...(await store.getKnownOwnerHandles('x')).entries()]
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
    assert.deepEqual(knownHandles, [
      ['1001', 'alice_handle'],
      ['2002', 'bob_handle'],
    ]);
    const [comparison] = await store.compare('alice-x');
    assert.equal(comparison.ownerId, '2002');
    assert.equal(comparison.ownerHandle, 'bob_handle');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stores selected X relationships as exact-ID claims without deciding in the migration tool', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'relationship-claims-test-'));
  const store = new ArchiveStore(directory);
  const alice: StoredArchive = {
    archiveId: 'alice-x-claims',
    ownerId: '1001',
    ownerHandle: 'alice_handle',
    platform: 'x',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: ['2002', '4004'],
    following: ['3003'],
    posts: [],
    likes: [],
  };
  const bob: StoredArchive = {
    archiveId: 'bob-x-claims',
    ownerId: '2002',
    ownerHandle: 'bob_handle',
    platform: 'x',
    importedAt: '2026-01-02T00:00:00.000Z',
    followers: [],
    following: ['1001'],
    posts: [],
    likes: [],
  };

  try {
    await store.save(alice);
    await store.save(bob);

    const savedAlice = await store.saveSelection(alice.archiveId, {
      postIds: [],
      followers: ['2002', '4004'],
      following: ['3003'],
    });
    const aliceClaims = savedAlice.relationshipClaims || [];
    assert.equal(aliceClaims.length, 3);
    const incomingClaim = aliceClaims.find(claim => claim.direction === 'target_follows_source');
    const outgoingClaim = aliceClaims.find(claim =>
      claim.direction === 'source_follows_target' &&
      claim.targetIdentityMatch.value === identityKey('platform_account_id', 'x', '3003')
    );
    const pendingWithdrawnClaim = aliceClaims.find(claim =>
      claim.targetIdentityMatch.value === identityKey('platform_account_id', 'x', '4004')
    );
    assert.ok(incomingClaim);
    assert.ok(outgoingClaim);
    assert.ok(pendingWithdrawnClaim);
    assert.deepEqual(incomingClaim.targetIdentityMatch, {
      type: 'platform_account_id',
      value: identityKey('platform_account_id', 'x', '2002'),
    });
    assert.equal(JSON.stringify(aliceClaims).includes('2002'), false);
    assert.equal(incomingClaim.verified, false);
    assert.equal(incomingClaim.status, 'pending_identity_match');
    assert.deepEqual(incomingClaim.confirmations, {});

    const bobSelection = await store.saveSelection(bob.archiveId, {
      postIds: [],
      followers: [],
      following: ['1001'],
    });
    assert.equal(
      bobSelection.relationshipClaims?.[0].relationshipKey,
      incomingClaim.relationshipKey
    );
    const bobMatches = await store.findRelationshipClaimsForIdentity('x', { platformAccountId: '2002' });
    assert.deepEqual(
      bobMatches.find(match => match.claim.claimId === incomingClaim.claimId)?.matchedSides,
      ['target']
    );
    assert.deepEqual(
      await store.findRelationshipClaimsForIdentity('x', { handle: 'bob_handle' }),
      []
    );
    assert.deepEqual(
      (await store.findRelationshipClaimsForIdentity('x', { platformAccountId: '1001' }))
        .find(match => match.claim.claimId === incomingClaim.claimId)?.matchedSides,
      ['source']
    );

    const deselected = await store.saveSelection(alice.archiveId, {
      postIds: [],
      followers: [],
      following: [],
    });
    assert.equal(
      deselected.relationshipClaims?.find(claim => claim.claimId === incomingClaim.claimId)?.status,
      'withdrawn'
    );
    assert.equal(
      deselected.relationshipClaims?.find(claim => claim.claimId === outgoingClaim.claimId)?.status,
      'withdrawn'
    );
    assert.equal(
      deselected.relationshipClaims?.find(claim => claim.claimId === pendingWithdrawnClaim.claimId)?.status,
      'withdrawn'
    );
    assert.equal(
      (await store.findRelationshipClaimsForIdentity('x', { platformAccountId: '2002' }))
        .some(match => match.claim.claimId === incomingClaim.claimId),
      false
    );
    assert.deepEqual(await store.findRelationshipClaimsForIdentity('x', { platformAccountId: '4004' }), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('matches Instagram relationship claims by normalized account handle', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'instagram-relationship-claims-test-'));
  const store = new ArchiveStore(directory);
  const archive: StoredArchive = {
    archiveId: 'instagram-claims',
    ownerId: 'my_handle',
    ownerHandle: 'my_handle',
    platform: 'instagram',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: ['@SomeFollower'],
    following: [],
    posts: [],
    likes: [],
  };

  try {
    await store.save(archive);
    const saved = await store.saveSelection(archive.archiveId, {
      postIds: [],
      followers: ['@SomeFollower'],
      following: [],
    });
    assert.equal(saved.relationshipClaims?.[0].direction, 'target_follows_source');
    assert.deepEqual(saved.relationshipClaims?.[0].targetIdentityMatch, {
      type: 'handle',
      value: identityKey('handle', 'instagram', 'somefollower'),
    });
    assert.equal(
      (await store.findRelationshipClaimsForIdentity('instagram', { handle: '@SOMEFOLLOWER' })).length,
      1
    );
    assert.deepEqual(
      (await store.findRelationshipClaimsForIdentity('instagram', { handle: 'MY_HANDLE' }))
        .find(match => match.claim.claimId === saved.relationshipClaims?.[0].claimId)?.matchedSides,
      ['source']
    );
    assert.equal(
      (await store.findRelationshipClaimsForIdentity('instagram', { handle: 'different' })).length,
      0
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('defaults selections to all archive data and compares only selected items', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'archive-selection-test-'));
  const store = new ArchiveStore(directory);
  const alice: StoredArchive = {
    archiveId: 'alice-archive',
    ownerId: 'alice',
    platform: 'instagram',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: ['bob', 'common-follower'],
    following: ['bob', 'common-following'],
    posts: [createPost('alice-post-id', 'Alice post caption')],
    likes: [createLike('bob-post-id')],
  };
  const bob: StoredArchive = {
    archiveId: 'bob-archive',
    ownerId: 'bob',
    platform: 'instagram',
    importedAt: '2026-01-02T00:00:00.000Z',
    followers: ['alice', 'common-follower'],
    following: ['alice', 'common-following'],
    posts: [createPost('bob-post-id', 'Bob post caption')],
    likes: [createLike('alice-post-id')],
  };

  try {
    await store.save(alice);
    await store.save(bob);
    assert.deepEqual((await store.get('alice-archive'))?.selection, {
      postIds: ['alice-post-id'],
      followers: ['bob', 'common-follower'],
      following: ['bob', 'common-following'],
    });

    await store.saveSelection('alice-archive', {
      postIds: [],
      followers: ['common-follower'],
      following: ['common-following'],
    });
    await store.saveSelection('bob-archive', {
      postIds: ['bob-post-id'],
      followers: ['common-follower'],
      following: ['common-following'],
    });

    const [comparison] = await store.compare('alice-archive');
    assert.equal(comparison.follows, null);
    assert.equal(comparison.youFollowThem, false);
    assert.equal(comparison.theyFollowYou, false);
    assert.equal(comparison.sharedFollowingCount, 1);
    assert.equal(comparison.sharedFollowersCount, 1);
    assert.equal(comparison.likesOnTheirPosts[0].postId, 'bob-post-id');
    assert.equal(comparison.likesOnTheirPosts[0].postCaption, 'Bob post caption');
    assert.equal(comparison.likesOnTheirPosts[0].matchType, 'id');
    assert.deepEqual(comparison.theyLikeYourPosts, []);
    assert.deepEqual((await store.get('alice-archive'))?.selection?.postIds, []);

    await store.saveSelection('alice-archive', {
      postIds: [],
      followers: ['bob'],
      following: [],
    });
    const [followerMatch] = await store.compare('alice-archive');
    assert.equal(followerMatch.theyFollowYou, true);
    assert.equal(followerMatch.youFollowThem, false);
    assert.equal(followerMatch.follows, 'follower');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('uses the other archive when a relationship is missing from the current archive', () => {
  const current: StoredArchive = {
    archiveId: 'current',
    ownerId: 'alice',
    platform: 'instagram',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: [],
    following: ['bob'],
    posts: [],
    likes: [],
  };
  const other: StoredArchive = {
    archiveId: 'other',
    ownerId: 'bob',
    platform: 'instagram',
    importedAt: '2026-01-02T00:00:00.000Z',
    followers: [],
    following: ['alice'],
    posts: [],
    likes: [],
  };

  const comparison = compareArchives(current, other);
  assert.equal(comparison.youFollowThem, true);
  assert.equal(comparison.theyFollowYou, true);
  assert.equal(comparison.follows, 'mutual');
});

test('does not include unchecked followers, following, or posts in the migration summary matches', () => {
  const current: StoredArchive = {
    archiveId: 'current',
    ownerId: 'alice',
    platform: 'instagram',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: ['bob'],
    following: ['bob'],
    posts: [createPost('alice-post', 'Alice selected post')],
    likes: [],
  };
  const other: StoredArchive = {
    archiveId: 'other',
    ownerId: 'bob',
    platform: 'instagram',
    importedAt: '2026-01-02T00:00:00.000Z',
    followers: ['alice'],
    following: ['alice'],
    posts: [createPost('bob-post', 'Bob post')],
    likes: [createLike('alice-post')],
  };

  const comparison = compareArchives(current, other, {
    postIds: [],
    followers: [],
    following: [],
  });

  assert.equal(comparison.youFollowThem, false);
  assert.equal(comparison.theyFollowYou, false);
  assert.equal(comparison.follows, null);
  assert.deepEqual(comparison.theyLikeYourPosts, []);
});

test('does not use the other archive to restore relationships explicitly unchecked by the current account', () => {
  const current: StoredArchive = {
    archiveId: 'current',
    ownerId: 'alice',
    platform: 'instagram',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: ['bob'],
    following: ['bob'],
    posts: [],
    likes: [],
  };
  const other: StoredArchive = {
    archiveId: 'other',
    ownerId: 'bob',
    platform: 'instagram',
    importedAt: '2026-01-02T00:00:00.000Z',
    followers: ['alice'],
    following: ['alice'],
    posts: [],
    likes: [],
  };

  const comparison = compareArchives(current, other, {
    postIds: [],
    followers: [],
    following: [],
  });

  assert.equal(comparison.youFollowThem, false);
  assert.equal(comparison.theyFollowYou, false);
});

test('rejects selections that reference items outside the archive', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'archive-selection-validation-test-'));
  const store = new ArchiveStore(directory);
  const archive: StoredArchive = {
    archiveId: 'archive',
    ownerId: 'alice',
    platform: 'instagram',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: [],
    following: [],
    posts: [],
    likes: [],
  };

  try {
    await store.save(archive);
    await assert.rejects(
      store.saveSelection('archive', { postIds: ['missing'], followers: [], following: [] }),
      /Selection contains items not present/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('does not compare archives from the same owner or a different platform', () => {
  const base: StoredArchive = {
    archiveId: 'base',
    ownerId: 'alice',
    platform: 'instagram',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: [],
    following: [],
    posts: [],
    likes: [],
  };
  const other = { ...base, archiveId: 'other', ownerId: 'bob' };
  const differentPlatform = { ...other, platform: 'facebook' as const };

  assert.throws(() => compareArchives(base, differentPlatform), /different platforms/);
});

test('keeps a separate signed session for each profile used in the browser', () => {
  const cookies: string[] = [];
  const response = { cookie: (name: string, value: string) => { cookies.push(`${name}=${value}`); } } as any;
  setSessionUser(response, 'alice-id');
  setSessionUser(response, 'bob-id');
  const requestWith = (cookie: string, profile?: string) => ({
    headers: { cookie: `other=1; ${cookie}` },
    get: (name: string) => name.toLowerCase() === 'x-mntl-user' ? profile : undefined,
  }) as any;
  const bothSessions = cookies.join('; ');

  assert.deepEqual(getSessionUserIds(requestWith(bothSessions)), ['alice-id', 'bob-id']);
  assert.equal(getSessionUserId(requestWith(bothSessions, 'alice-id')), 'alice-id');
  assert.equal(getSessionUserId(requestWith(bothSessions, 'bob-id')), 'bob-id');
  assert.equal(getSessionUserId(requestWith(bothSessions)), null);
  assert.equal(getSessionUserId(requestWith(cookies[0])), 'alice-id');
  assert.equal(getSessionUserId(requestWith(cookies[0], 'bob-id')), null);
  assert.equal(getSessionUserId(requestWith(cookies[0].replace(/alice-id/g, 'bob-id'))), null);
  assert.equal(getSessionUserId(requestWith(cookies[0].replace('mntl_session_alice-id', 'mntl_session_bob-id'))), null);
});

test('copies post media out of the archive and serves only stored files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'media-extract-test-'));
  const archivePath = join(directory, 'archive.zip');
  const mediaRoot = join(directory, 'media');
  const archiveId = 'a'.repeat(32);
  const zip = new AdmZip();
  zip.addFile('export/media/posts/photo.jpg', Buffer.from('photo'));
  zip.addFile('export/messages/inbox/chat.json', Buffer.from('{}'));
  zip.addFile('your_facebook_activity/posts/media/your_posts/123.jpg', Buffer.from('facebook'));
  zip.addFile('your_facebook_activity/messages/inbox/chat/photos/9.jpg', Buffer.from('private'));
  zip.writeZip(archivePath);

  try {
    const [post, facebookPost] = await extractPostMedia(archivePath, archiveId, [{
      ...createPost('post-1', 'Caption'),
      mediaUrls: ['media/posts/photo.jpg', 'messages/inbox/chat.json', 'media/missing.jpg'],
    }, {
      ...createPost('post-2', 'Facebook'),
      mediaUrls: ['your_facebook_activity/posts/media/your_posts/123.jpg', 'your_facebook_activity/messages/inbox/chat/photos/9.jpg'],
    }], mediaRoot);
    const [storedName, ...unchanged] = post.mediaUrls!;
    const [facebookName, privateUri] = facebookPost.mediaUrls!;
    assert.equal(readFileSync(storedMediaPath(archiveId, facebookName, mediaRoot)!, 'utf8'), 'facebook');
    assert.equal(privateUri, 'your_facebook_activity/messages/inbox/chat/photos/9.jpg');

    assert.match(storedName, /^[a-f0-9]{32}\.jpg$/);
    assert.deepEqual(unchanged, ['messages/inbox/chat.json', 'media/missing.jpg']);
    const storedPath = storedMediaPath(archiveId, storedName, mediaRoot);
    assert.equal(readFileSync(storedPath!, 'utf8'), 'photo');
    assert.equal(storedMediaPath(archiveId, 'media/posts/photo.jpg', mediaRoot), null);
    assert.equal(storedMediaPath(archiveId, '../mntl-users.json', mediaRoot), null);
    assert.equal(storedMediaPath('../data', storedName, mediaRoot), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('hides posts other MNTL users did not select from activity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'activity-selection-test-'));
  const store = new ArchiveStore(directory);
  const alice: StoredArchive = {
    archiveId: 'alice-activity-selection',
    ownerId: 'alice_ig',
    mntlUserId: 'alice-id',
    mntlHandle: 'mntl_alice',
    platform: 'instagram',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: [],
    following: [],
    posts: [],
    likes: [createLike('bob-private-post')],
  };
  const bob: StoredArchive = {
    archiveId: 'bob-activity-selection',
    ownerId: 'bob_ig',
    mntlUserId: 'bob-id',
    mntlHandle: 'mntl_bob',
    platform: 'instagram',
    importedAt: '2026-01-02T00:00:00.000Z',
    followers: [],
    following: [],
    posts: [createPost('bob-private-post', 'Not for sharing')],
    likes: [],
  };

  try {
    await store.save(alice);
    await store.save(bob);
    await store.saveSelection(bob.archiveId, { postIds: [], followers: [], following: [] });
    const [activity] = await store.getMntlActivities('alice-id');
    assert.equal(activity.target.type, 'unknown');
    assert.equal(activity.target.text, undefined);
    assert.equal(activity.target.ownerHandle, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Facebook stores UTF-8 text as Latin-1 escapes; this mimics that encoding.
function facebookJson(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value).replace(/[^\x00-\x7f]/gu, char =>
    [...Buffer.from(char, 'utf8')].map(byte => `\\u00${byte.toString(16).padStart(2, '0')}`).join('')
  ));
}

test('extracts Facebook profile, posts, friends, reactions, and comments', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'facebook-adapter-test-'));
  const archivePath = join(directory, 'archive.zip');
  const zip = new AdmZip();
  zip.addFile('personal_information/profile_information/profile_information.json', facebookJson({
    profile_v2: { name: { full_name: 'Zoë Owner' }, profile_uri: 'https://www.facebook.com/profile.php?id=1001', registration_timestamp: 1600000000 },
  }));
  zip.addFile('your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json', facebookJson([
    {
      timestamp: 1700000000,
      attachments: [{ data: [
        { media: { uri: 'your_facebook_activity/posts/media/your_posts/111.jpg' } },
        { media: { uri: 'your_facebook_activity/posts/media/stickers_used/222.webp' } },
      ] }],
      data: [{ post: 'Trip with @[2002:2048:Reno Goelen] — great!' }, { update_timestamp: 1700000000 }],
    },
    { timestamp: 1700000100, data: [{ update_timestamp: 1700000100 }], title: 'Zoë Owner updated her status.' },
  ]));
  zip.addFile('your_facebook_activity/posts/your_videos.json', facebookJson({ videos_v2: [
    { uri: 'your_facebook_activity/posts/media/videos/333.mp4', creation_timestamp: 1700000200, description: '' },
  ] }));
  zip.addFile('your_facebook_activity/posts/your_uncategorized_photos.json', facebookJson({ other_photos_v2: [
    { uri: 'your_facebook_activity/posts/media/your_posts/111.jpg', creation_timestamp: 1700000000 },
  ] }));
  zip.addFile('your_facebook_activity/posts/trash.json', facebookJson({ trash_v2: [{ timestamp: 1, data: [{ post: 'deleted' }] }] }));
  zip.addFile('connections/friends/your_friends.json', facebookJson({ friends_v2: [{ name: 'Renée Friend', timestamp: 1690000000 }] }));
  zip.addFile("connections/followers/who_you've_followed.json", facebookJson({ following_v3: [{ name: 'Some Page', timestamp: 1690000001 }] }));
  zip.addFile('your_facebook_activity/comments_and_reactions/likes_and_reactions.json', facebookJson([
    {
      timestamp: 1700000300,
      label_values: [
        { label: 'Reactie', value: 'Geweldig' },
        { label: 'URL', value: 'https://www.facebook.com/reno.goelen/posts/pfbid0abc', href: 'https://www.facebook.com/reno.goelen/posts/pfbid0abc' },
        { label: 'Titel', value: '' },
        { label: 'Naam', value: 'Reno Goelen' },
      ],
      fbid: '444',
    },
    {
      timestamp: 1700000400,
      label_values: [
        { label: 'Reaction', value: 'Like' },
        { label: 'URL', href: 'https://www.facebook.com/permalink.php?story_fbid=pfbid0def&id=555&comment_id=666' },
        { dict: [{ dict: [{ label: 'Name', value: 'Comment Author' }], title: '' }] },
      ],
      fbid: '666',
    },
  ]));
  zip.addFile('your_facebook_activity/comments_and_reactions/likes_and_reactions_1.json', facebookJson([
    { timestamp: 1700000301, data: [{ reaction: { reaction: 'LOVE', actor: 'Zoë Owner' } }], title: 'Zoë Owner heeft gereageerd op het bericht van Reno Goelen.' },
    { timestamp: 1650000000, data: [{ reaction: { reaction: 'LIKE', actor: 'Zoë Owner' } }], title: 'Zoë Owner vindt het bericht van Danssport Vlaanderen leuk.' },
  ]));
  zip.addFile('your_facebook_activity/comments_and_reactions/comments.json', facebookJson({ comments_v2: [
    { timestamp: 1700000500, data: [{ comment: { timestamp: 1700000500, comment: 'Mooi zo! 😊', author: 'Zoë Owner' } }], title: "Zoë Owner commented on Jane D'haen's photo." },
    { timestamp: 1700000600, data: [{ comment: { timestamp: 1700000600, comment: '', author: 'Zoë Owner' } }], title: 'Zoë Owner commented on a post.' },
  ] }));
  zip.writeZip(archivePath);

  try {
    const adapter = new FacebookAdapter();
    assert.equal(adapter.detect(new AdmZip(archivePath).getEntries().map(entry => entry.entryName)), true);

    const [user] = await adapter.extractUsers(archivePath);
    assert.equal(user.username, '1001');
    assert.equal(user.displayName, 'Zoë Owner');

    const posts = await adapter.extractPosts(archivePath);
    assert.equal(posts.length, 2);
    assert.equal(posts[0].content, 'Trip with @Reno Goelen — great!');
    assert.deepEqual(posts[0].mentions, ['Reno Goelen']);
    assert.deepEqual(posts[0].mediaUrls, ['your_facebook_activity/posts/media/your_posts/111.jpg']);
    assert.equal(posts[1].originalPlatformId, '333');
    assert.equal(posts[1].postType, 'reel');

    const relations = await adapter.extractFollowRelations(archivePath);
    assert.deepEqual(relations.map(relation => [relation.followingId, relation.relationship]), [
      ['Renée Friend', 'friend'],
      ['Some Page', 'follow'],
    ]);
    assert.deepEqual(await adapter.describeLimitations(archivePath), []);

    const likes = await adapter.extractLikes(archivePath);
    assert.equal(likes.length, 3);
    assert.deepEqual(
      likes.map(like => [like.postId, like.postOwnerId, like.postOwnerName]),
      [
        ['444', 'reno.goelen', 'Reno Goelen'],
        ['666', undefined, 'Comment Author'],
        [likes[2].postId, undefined, 'Danssport Vlaanderen'],
      ]
    );

    const comments = await adapter.extractComments(archivePath);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].content, 'Mooi zo! 😊');
    assert.equal(comments[0].postOwnerName, "Jane D'haen");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reads Facebook content owners from URLs and localized titles', () => {
  assert.equal(facebookOwnerFromUrl('https://www.facebook.com/reno.goelen/posts/pfbid0abc'), 'reno.goelen');
  assert.equal(facebookOwnerFromUrl('https://www.facebook.com/permalink.php?story_fbid=x&id=100073428517116'), '100073428517116');
  assert.equal(facebookOwnerFromUrl('https://www.facebook.com/groups/samplesize/permalink/1/'), undefined);
  assert.equal(facebookOwnerFromUrl('https://www.facebook.com/reel/123'), undefined);
  assert.equal(facebookOwnerFromUrl('https://example.com/reno.goelen'), undefined);
  assert.equal(facebookOwnerFromTitle("Reno Goelen reacted to The Labour Party's post."), 'The Labour Party');
  assert.equal(facebookOwnerFromTitle('Reno Goelen replied to his own comment.'), undefined);
  assert.equal(facebookOwnerFromTitle('Sofie heeft gereageerd op een foto van Kelly Van Houdt.'), 'Kelly Van Houdt');
  assert.equal(facebookOwnerFromTitle('Sofie heeft een opmerking geplaatst bij de reel van  Cognitief-sterk-werk.'), 'Cognitief-sterk-werk');
});

test('attributes Facebook activity to the MNTL owner of the reacted-to content', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'facebook-activity-test-'));
  const store = new ArchiveStore(directory);
  const facebookArchive = (overrides: Partial<StoredArchive>): StoredArchive => ({
    archiveId: 'archive',
    ownerId: 'owner',
    platform: 'facebook',
    importedAt: '2026-01-01T00:00:00.000Z',
    followers: [],
    following: [],
    posts: [],
    likes: [],
    ...overrides,
  });
  const sofie = facebookArchive({
    archiveId: 'sofie-facebook',
    ownerId: '100079198850319',
    ownerHandle: '100079198850319',
    ownerName: 'Youme Sofie',
    mntlUserId: 'sofie-id',
    mntlHandle: 'mntl_sofie',
    likes: [
      LikeSchema.parse({ userId: '100079198850319', postId: '444', platform: 'facebook', postOwnerId: 'Reno.Goelen', likedAt: new Date('2026-10-25T00:00:00Z') }),
      LikeSchema.parse({ userId: '100079198850319', postId: '555', platform: 'facebook', postOwnerName: 'reno  goelen', likedAt: new Date('2026-10-24T00:00:00Z') }),
      LikeSchema.parse({ userId: '100079198850319', postId: '666', platform: 'facebook', postOwnerName: 'Gina Moons', likedAt: new Date('2026-10-23T00:00:00Z') }),
    ],
  });
  const reno = facebookArchive({
    archiveId: 'reno-facebook',
    ownerId: 'reno.goelen',
    ownerHandle: 'reno.goelen',
    ownerName: 'Reno Goelen',
    mntlUserId: 'reno-id',
    mntlHandle: 'mntl_reno',
  });

  try {
    await store.save(sofie);
    await store.save(reno);
    const activities = await store.getMntlActivities('sofie-id');
    assert.deepEqual(activities.map(activity => [activity.target.platformPostId, activity.target.ownerHandle]), [
      ['444', 'mntl_reno'],
      ['555', 'mntl_reno'],
      ['666', undefined],
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('connects Facebook friends across archives by display name, apart from following', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'facebook-connection-test-'));
  const store = new ArchiveStore(directory);
  const base = { platform: 'facebook' as const, posts: [], likes: [], followers: [], importedAt: '2026-01-01T00:00:00.000Z' };
  const alice: StoredArchive = {
    ...base, archiveId: 'alice-fb', ownerId: 'alice.smith', ownerHandle: 'alice.smith', ownerName: 'Alice Smith',
    mntlUserId: 'alice-id', mntlHandle: 'mntl_alice', friends: ['Bob Jones', 'Carol Page'], following: [],
  };
  const bob: StoredArchive = {
    ...base, archiveId: 'bob-fb', ownerId: '2002', ownerHandle: '2002', ownerName: 'Bob Jones',
    mntlUserId: 'bob-id', mntlHandle: 'mntl_bob', friends: ['alice  SMITH'], following: [],
  };

  try {
    await store.save(alice);
    await store.save(bob);
    const saved = await store.saveSelection(alice.archiveId, { postIds: [], followers: [], following: [], friends: ['Bob Jones'] });
    assert.deepEqual(saved.relationshipClaims?.map(claim => claim.direction), ['mutual_friends']);
    const expected = [{ platform: 'facebook', youFollowThem: false, theyFollowYou: false, friends: true }];
    assert.deepEqual((await store.getMntlConnections('alice-id')).map(connection => connection.platforms), [expected]);
    assert.deepEqual((await store.getMntlConnections('bob-id')).map(connection => connection.platforms), [expected]);

    // The friendship key is the same whichever friend's archive it comes from.
    const fromBob = await store.saveSelection(bob.archiveId, { postIds: [], followers: [], following: [], friends: ['alice  SMITH'] });
    assert.equal(fromBob.relationshipClaims?.[0].relationshipKey, saved.relationshipClaims?.[0].relationshipKey);

    const comparison = compareArchives(saved, bob);
    assert.equal(comparison.areFriends, true);
    assert.equal(comparison.follows, null);

    const confirmed = await store.confirmSelection(alice.archiveId);
    assert.deepEqual(confirmed.friends, ['Bob Jones']);
    await assert.rejects(store.saveSelection(alice.archiveId, {
      postIds: [], followers: [], following: [], friends: ['Carol Page'],
    }), /not present in this archive/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('warns when a Facebook export only covers a limited date range', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'facebook-range-test-'));
  const archivePath = join(directory, 'archive.zip');
  const zip = new AdmZip();
  zip.addFile('personal_information/profile_information/profile_information.json', facebookJson({
    profile_v2: { name: { full_name: 'Old Account' }, username: 'old.account', registration_timestamp: Date.parse('2018-01-01') / 1000 },
  }));
  zip.addFile('connections/friends/your_friends.json', facebookJson({ friends_v2: [
    { name: 'Recent Friend', timestamp: Date.parse('2025-11-01') / 1000 },
    { name: 'Newer Friend', timestamp: Date.parse('2026-09-01') / 1000 },
  ] }));
  zip.addFile('your_facebook_activity/comments_and_reactions/comments.json', facebookJson({ comments_v2: [] }));
  zip.writeZip(archivePath);

  try {
    const [warning] = await new FacebookAdapter().describeLimitations(archivePath);
    assert.match(warning, /only contains data from 2025-11-01 onwards/);
    assert.match(warning, /"All time"/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stores only fingerprints of other people\'s post text and identities', () => {
  const like = minimizeLike(LikeSchema.parse({
    userId: 'me',
    postId: 'post-1',
    platform: 'facebook',
    postText: 'Someone else\'s caption',
    postOwnerId: 'jane.doe',
    postOwnerName: 'Jane Doe',
  }));
  assert.equal(like.postText, undefined);
  assert.equal(like.postOwnerId, undefined);
  assert.equal(like.postOwnerName, undefined);
  assert.match(like.postTextKey!, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(like).includes('Jane'), false);
  assert.equal(JSON.stringify(like).includes('caption'), false);
});

test('matches liked posts by caption fingerprint after minimization', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fingerprint-match-test-'));
  const store = new ArchiveStore(directory);
  const base = { platform: 'instagram' as const, followers: [], following: [], importedAt: '2026-01-01T00:00:00.000Z' };
  try {
    await store.save({
      ...base, archiveId: 'alice-fp', ownerId: 'alice', mntlUserId: 'alice-id', mntlHandle: 'mntl_alice', posts: [],
      likes: [minimizeLike({ ...createLike('unknown-id', '  Sunset   at the BEACH '), userId: 'alice' })],
    });
    await store.save({
      ...base, archiveId: 'bob-fp', ownerId: 'bob', mntlUserId: 'bob-id', mntlHandle: 'mntl_bob',
      posts: [createPost('bob-post', 'Sunset at the beach')], likes: [],
    });
    const [activity] = await store.getMntlActivities('alice-id');
    assert.equal(activity.target.platformPostId, 'bob-post');
    assert.equal(activity.target.ownerHandle, 'mntl_bob');
    assert.equal(activity.target.text, 'Sunset at the beach');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deletes unselected relationships on confirmation or after the selection window', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'retention-test-'));
  const store = new ArchiveStore(directory, new OptOutStore(join(directory, '..', `${Date.now()}-opt-outs.json`)));
  const base = { platform: 'instagram' as const, posts: [], likes: [], followers: ['kept', 'dropped'], following: ['kept', 'dropped'] };
  try {
    await store.save({ ...base, archiveId: 'confirmed', ownerId: 'a', importedAt: new Date().toISOString() });
    await store.save({ ...base, archiveId: 'stale', ownerId: 'b', importedAt: '2026-01-01T00:00:00.000Z' });
    await store.save({ ...base, archiveId: 'fresh', ownerId: 'c', importedAt: new Date().toISOString() });
    for (const archiveId of ['confirmed', 'stale', 'fresh']) {
      await store.saveSelection(archiveId, { postIds: [], followers: ['kept'], following: ['kept'] });
    }

    const confirmed = await store.confirmSelection('confirmed');
    assert.deepEqual([confirmed.followers, confirmed.following], [['kept'], ['kept']]);
    assert.ok(confirmed.selectionConfirmedAt);

    await store.applyRetention(new Date('2026-03-01T00:00:00.000Z'));
    assert.deepEqual((await store.get('stale'))?.followers, ['kept']);
    assert.deepEqual((await store.get('fresh'))?.followers, ['kept', 'dropped']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('expires unconfirmed claims after a year and removes people who opted out', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'opt-out-test-'));
  const store = new ArchiveStore(join(directory, 'archives'), new OptOutStore(join(directory, 'opt-outs.json')));
  try {
    await store.save({
      archiveId: 'fb-archive', ownerId: 'owner', ownerName: 'Owner Name', platform: 'facebook',
      importedAt: new Date().toISOString(), posts: [], likes: [],
      followers: ['Jane Doe', 'John Roe'], following: ['Jane Doe'], mntlUserId: 'owner-id', mntlHandle: 'mntl_owner',
    });
    await store.saveSelection('fb-archive', { postIds: [], followers: ['Jane Doe', 'John Roe'], following: ['Jane Doe'] });
    assert.equal((await store.get('fb-archive'))?.relationshipClaims?.length, 3);

    await store.optOut('facebook', 'jane  DOE');
    const archive = await store.get('fb-archive');
    assert.deepEqual(archive?.followers, ['John Roe']);
    assert.deepEqual(archive?.following, []);
    assert.deepEqual(archive?.selection?.followers, ['John Roe']);
    assert.equal(archive?.relationshipClaims?.length, 1);
    assert.equal(readFileSync(join(directory, 'opt-outs.json'), 'utf8').includes('Jane'), false);

    await store.saveSelection('fb-archive', { postIds: [], followers: ['John Roe'], following: [] });
    await store.applyRetention(new Date(Date.now() + 366 * 24 * 60 * 60 * 1000));
    assert.deepEqual((await store.get('fb-archive'))?.relationshipClaims, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('imports Instagram stories and matches story likes to the exact story', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'instagram-stories-test-'));
  const ownerArchive = join(directory, 'owner.zip');
  const likerArchive = join(directory, 'liker.zip');
  const owner = new AdmZip();
  owner.addFile('export/your_instagram_activity/media/stories.json', facebookJson({ ig_stories: [
    { uri: 'media/stories/202610/18219106489353268.mp4', creation_timestamp: 1792194236, title: 'Café vibes ☕', media_metadata: { video_metadata: {} } },
    { uri: 'media/other/17900000000000001.jpg', creation_timestamp: 1792194300, title: '' },
  ] }));
  owner.addFile('export/media/stories/202610/18219106489353268.mp4', Buffer.from('video'));
  owner.writeZip(ownerArchive);
  const liker = new AdmZip();
  liker.addFile('your_instagram_activity/story_interactions/story_likes.json', facebookJson([{
    timestamp: 1792308648,
    label_values: [
      { label: 'URL', value: 'https://www.instagram.com/stories/renogoelen/4009538356920512950', href: 'https://www.instagram.com/stories/renogoelen/4009538356920512950' },
      { label: 'Propriétaire', dict: [] },
    ],
    fbid: '18219106489353268',
  }]));
  liker.addFile('your_instagram_activity/story_interactions/emoji_story_reactions.json', facebookJson([{
    timestamp: 1792308700,
    label_values: [{ label: 'URL', href: 'https://www.instagram.com/stories/someone_else/123' }],
    fbid: '17000000000000009',
  }]));
  liker.writeZip(likerArchive);

  const store = new ArchiveStore(join(directory, 'archives'));
  try {
    const adapter = new InstagramAdapter();
    const stories = await adapter.extractPosts(ownerArchive);
    assert.deepEqual(stories.map(story => [story.originalPlatformId, story.postType, story.content, story.mediaTypes]), [
      ['18219106489353268', 'story', 'Café vibes ☕', ['video']],
      ['17900000000000001', 'story', undefined, ['image']],
    ]);

    const likes = await adapter.extractLikes(likerArchive);
    assert.deepEqual(likes.map(like => [like.postId, like.postOwnerId]).sort(), [
      ['17000000000000009', 'someone_else'],
      ['18219106489353268', 'renogoelen'],
    ]);

    const base = { platform: 'instagram' as const, followers: [], following: [], importedAt: '2026-10-20T00:00:00.000Z' };
    await store.save({ ...base, archiveId: 'reno-ig', ownerId: 'renogoelen', mntlUserId: 'reno-id', mntlHandle: 'mntl_reno', posts: stories, likes: [] });
    await store.save({
      ...base, archiveId: 'sofie-ig', ownerId: 'sofieyoume', mntlUserId: 'sofie-id', mntlHandle: 'mntl_sofie', posts: [],
      likes: likes.map(like => minimizeLike({ ...like, userId: 'sofieyoume' })),
    });
    const activities = await store.getMntlActivities('sofie-id');
    const storyLike = activities.find(activity => activity.target.platformPostId === '18219106489353268')!;
    const otherLike = activities.find(activity => activity.target.platformPostId === '17000000000000009')!;
    assert.deepEqual([storyLike.target.type, storyLike.target.ownerHandle, storyLike.target.text], ['story', 'mntl_reno', 'Café vibes ☕']);
    assert.equal(otherLike.target.ownerHandle, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('finds which contacts are MNTL users without exposing the others', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mntl-accounts-test-'));
  const store = new ArchiveStore(directory);
  const archive = (archiveId: string, platform: StoredArchive['platform'], ownerId: string, mntlUserId: string, extra: Partial<StoredArchive> = {}): StoredArchive => ({
    archiveId, platform, ownerId, mntlUserId, mntlHandle: `mntl_${mntlUserId}`, importedAt: '2026-01-01T00:00:00.000Z',
    followers: [], following: [], posts: [], likes: [], ...extra,
  });
  try {
    await store.save(archive('me-ig', 'instagram', 'me_ig', 'me'));
    await store.save(archive('bob-ig', 'instagram', 'bob_ig', 'bob'));
    await store.save(archive('bob-x', 'x', '2002', 'bob', { ownerHandle: 'bob_on_x' }));
    await store.save(archive('carol-fb', 'facebook', 'carol.c', 'carol', { ownerName: 'Carol Chen' }));
    await store.save(archive('dup1-ig', 'instagram', 'shared_name', 'dup1'));
    await store.save(archive('dup2-ig', 'instagram', 'shared_name', 'dup2'));

    const instagram = await store.findMntlAccounts('instagram', ['@BOB_IG', 'stranger', 'me_ig', 'shared_name'], 'me');
    assert.deepEqual([...instagram.entries()], [['@BOB_IG', { mntlUserId: 'bob', mntlHandle: 'mntl_bob', accountHandle: undefined }]]);

    const x = await store.findMntlAccounts('x', ['2002', '3003']);
    assert.deepEqual([...x.keys()], ['2002']);
    assert.equal(x.get('2002')?.accountHandle, 'bob_on_x');

    const facebook = await store.findMntlAccounts('facebook', ['carol  chen', 'Someone Else']);
    assert.deepEqual([...facebook.keys()], ['carol  chen']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('imports only Facebook posts made to the profile feed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'facebook-feed-test-'));
  const archivePath = join(directory, 'archive.zip');
  const zip = new AdmZip();
  const post = (timestamp: number, title: string, text: string, uri?: string) => ({
    timestamp,
    title,
    data: [{ post: text }],
    attachments: uri ? [{ data: [{ media: { uri } }] }] : [],
  });
  zip.addFile('your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json', facebookJson([
    post(1700000001, 'Sofie heeft een bericht gedeeld.', 'On my own feed'),
    post(1700000002, 'Sofie heeft een bericht gedeeld met de groep Reizen in Gambia.', 'Dutch group post'),
    post(1700000003, 'Reno Goelen posted in Fiat Tipo Club Belgium.', 'English group post'),
    post(1700000004, 'Sofie heeft een bericht gedeeld.', 'Group post with a generic title', 'your_facebook_activity/posts/media/your_posts/55.jpg'),
    post(1700000005, 'Sofie heeft op het profiel van Rita geschreven.', 'Happy birthday!'),
    post(1700000006, "Reno Goelen wrote on Jane Doe's timeline.", 'Hi Jane'),
    post(1700000007, 'Sofie heeft een nieuwe foto toegevoegd aan de tijdlijn van Tom.', 'Photo for Tom'),
    post(1700000008, "Reno Goelen added a new photo to Jane Doe's timeline.", 'Photo for Jane'),
    post(1700000009, 'Sofie heeft een nieuwe foto toegevoegd.', 'Photo on my own feed'),
  ]));
  zip.addFile('your_facebook_activity/groups/group_posts_and_comments.json', facebookJson({ group_posts_v2: [
    { timestamp: 1700000004, data: [{ post: 'Group post with a generic title' }], title: 'Sofie posted in Some Group.' },
  ] }));
  zip.addFile('your_facebook_activity/posts/your_uncategorized_photos.json', facebookJson({ other_photos_v2: [
    { uri: 'your_facebook_activity/posts/media/your_posts/55.jpg', creation_timestamp: 1700000004 },
  ] }));
  zip.writeZip(archivePath);

  try {
    const posts = await new FacebookAdapter().extractPosts(archivePath);
    assert.deepEqual(posts.map(item => item.content), ['On my own feed', 'Photo on my own feed']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
