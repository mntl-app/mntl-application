import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FacebookAdapter } from '../src/adapters/facebook/FacebookAdapter';
import { InstagramAdapter } from '../src/adapters/instagram/InstagramAdapter';
import { TikTokAdapter } from '../src/adapters/tiktok/TikTokAdapter';
import { XAdapter } from '../src/adapters/x/XAdapter';
import { ArchiveStore, compareArchives, StoredArchive } from '../src/etl/load/ArchiveStore';
import { InMemoryDataLoader } from '../src/etl/load/DataLoader';
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
