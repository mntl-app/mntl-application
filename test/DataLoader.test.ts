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
import { XAdapter } from '../src/adapters/x/XAdapter';
import { ArchiveStore, compareArchives, StoredArchive } from '../src/etl/load/ArchiveStore';
import { InMemoryDataLoader } from '../src/etl/load/DataLoader';
import { clearDevelopmentArchives } from '../src/etl/load/DevelopmentArchiveCleanup';
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
  const archives = join(directory, 'data', 'archives');
  mkdirSync(uploads);
  mkdirSync(archives, { recursive: true });
  writeFileSync(join(uploads, 'a'.repeat(32)), 'uploaded ZIP');
  writeFileSync(join(uploads, 'keep-me.txt'), 'unrelated upload file');
  writeFileSync(join(archives, 'archive-1.json'), 'stored archive');
  writeFileSync(join(archives, 'archive-1.json.123.tmp'), 'temporary archive');
  writeFileSync(join(archives, 'keep-me.txt'), 'unrelated file');

  try {
    assert.equal(await clearDevelopmentArchives(directory, 'production'), 0);
    assert.equal(existsSync(join(archives, 'archive-1.json')), true);

    assert.equal(await clearDevelopmentArchives(directory, 'development'), 3);
    assert.equal(existsSync(join(uploads, 'a'.repeat(32))), false);
    assert.equal(existsSync(join(archives, 'archive-1.json')), false);
    assert.equal(existsSync(join(archives, 'archive-1.json.123.tmp')), false);
    assert.equal(readFileSync(join(uploads, 'keep-me.txt'), 'utf8'), 'unrelated upload file');
    assert.equal(readFileSync(join(archives, 'keep-me.txt'), 'utf8'), 'unrelated file');
    assert.equal(existsSync(uploads), true);
    assert.equal(existsSync(archives), true);
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
    assert.equal(posts.length, 3);
    assert.equal(posts[0].postType, 'post');
    assert.deepEqual(posts[0].mediaUrls, ['data/tweets_media/tweet-photo-photo.jpg']);
    assert.equal(posts[0].mediaTypes?.[0], 'image');
    assert.equal(posts[1].postType, 'reel');
    assert.deepEqual(posts[1].mediaUrls, ['data/tweets_media/tweet-video-clip.mp4']);
    assert.equal(posts[1].mediaTypes?.[0], 'video');
    assert.equal(posts[2].postType, 'text');
    assert.equal(posts[2].content, 'Text-only [post]');

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
