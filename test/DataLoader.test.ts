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
import { FacebookAdapter } from '../src/adapters/facebook/FacebookAdapter';
import { InstagramAdapter } from '../src/adapters/instagram/InstagramAdapter';
import { TikTokAdapter } from '../src/adapters/tiktok/TikTokAdapter';
import { TikTokMediaDownloader } from '../src/adapters/tiktok/TikTokMediaDownloader';
import { XAdapter } from '../src/adapters/x/XAdapter';
import { ArchiveStore, compareArchives, StoredArchive } from '../src/etl/load/ArchiveStore';
import { InMemoryDataLoader } from '../src/etl/load/DataLoader';
import { clearDevelopmentArchives } from '../src/etl/load/DevelopmentArchiveCleanup';
import { MntlUserStore } from '../src/etl/load/MntlUserStore';
import { LikeSchema, PostSchema } from '../src/types/schemas';

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
  assert.equal(match.other[0].content, '🥰');
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
    assert.deepEqual(comparison.sharedFollowing, ['common-following']);
    assert.deepEqual(comparison.sharedFollowers, ['common-follower']);
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
      claim.direction === 'source_follows_target' && claim.targetAccount.platformAccountId === '3003'
    );
    const pendingWithdrawnClaim = aliceClaims.find(claim =>
      claim.targetAccount.platformAccountId === '4004'
    );
    assert.ok(incomingClaim);
    assert.ok(outgoingClaim);
    assert.ok(pendingWithdrawnClaim);
    assert.equal(incomingClaim.targetAccount.handle, 'bob_handle');
    assert.deepEqual(incomingClaim.targetIdentityMatch, {
      type: 'platform_account_id',
      value: '2002',
    });
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
      value: 'somefollower',
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
    assert.deepEqual(comparison.sharedFollowing, ['common-following']);
    assert.deepEqual(comparison.sharedFollowers, ['common-follower']);
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
