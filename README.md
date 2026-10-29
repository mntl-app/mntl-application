# MNTL Migration Tool

A unified data migration tool for ingesting social media archives from multiple platforms (Instagram, Facebook, X, TikTok) and normalizing them into a single schema for Expo-powered React Native apps.

## Architecture

This tool uses a modular ETL (Extract, Transform, Load) pattern with a factory-based adapter system:

- **Extract**: Handles ZIP file extraction using `adm-zip`
- **Transform**: Normalizes platform-specific data into a common schema using Zod validation
- **Load**: Saves normalized data to a database (with in-memory and PostgreSQL implementations)
- **Queue**: Uses in-memory queue by default for development (optional BullMQ with Redis for production)

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **ZIP Extraction**: `adm-zip`
- **Validation**: `zod`
- **Job Queue**: In-memory queue (optional `bullmq` with Redis for production)
- **API**: Express with `multer` for file uploads

## Project Structure

```
src/
├── adapters/           # Platform-specific adapters
│   ├── BaseAdapter.ts  # Base interface and abstract class
│   ├── AdapterFactory.ts  # Factory for detecting and creating adapters
│   ├── instagram/
│   ├── facebook/
│   ├── x/
│   └── tiktok/
├── api/                # Express API endpoints
│   └── server.ts
├── config/             # Configuration files
├── etl/                # ETL pipeline modules
│   ├── extract/        # ZIP extraction
│   ├── transform/      # Data normalization
│   └── load/           # Database operations
├── queue/              # Job queue implementations
│   ├── JobQueue.ts     # BullMQ with Redis (production)
│   └── InMemoryJobQueue.ts  # In-memory queue (development)
├── types/              # TypeScript types and Zod schemas
│   └── schemas.ts
└── index.ts            # Application entry point
```

## Setup

### Prerequisites

- Node.js 18+
- Redis server (optional, only needed for production with BullMQ)

### Installation

1. Clone the repository:
```bash
cd "MNTL migration"
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
PORT=3000
# REDIS_URL=redis://localhost:6379  # Optional, only for production
NODE_ENV=development
```

4. (Optional) For production with Redis:
```bash
# Install Redis dependencies
npm install bullmq ioredis

# Start Redis (macOS using Homebrew)
brew services start redis

# Or using Docker
docker run -d -p 6379:6379 redis
```

Note: The tool uses an in-memory queue by default and works without Redis. Redis is only needed for production environments with multiple workers.

## Running the Server

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

The server will start on port 3000 (or the port specified in `.env`).

## Queue Configuration

### Development Mode (Default)
The tool uses an in-memory queue by default. This requires no external dependencies and is perfect for development and testing.
git stat
When `NODE_ENV=development`, each server startup clears app-managed uploaded
archives in `uploads/`, stored archive JSON/temp files in `data/archives/`,
downloaded archive media, and the prototype MNTL handle registry. This keeps
development runs ready for a fresh signup and import. Other files and all
archive data in non-development environments are left untouched.

MNTL prototype profiles are stored separately in `data/mntl-users.json` and
cleared on development startup. The browser does not persist the selected
handle across page reloads. A profile handle is not verified and does not
provide authentication. Each imported archive stores the selected MNTL profile
ID and handle alongside its platform-specific account identity. Connection
results group linked archive matches by MNTL profile and list each matching
platform once.

### Production Mode (with Redis)
For production environments with multiple workers, use BullMQ with Redis:

1. Install Redis dependencies:
```bash
npm install bullmq ioredis
```

2. Update imports in `src/api/server.ts` and `src/index.ts`:
```typescript
// Change from:
import { InMemoryJobQueue } from './queue/InMemoryJobQueue';

// To:
import { JobQueue } from './queue/JobQueue';
```

3. Update the queue instantiation:
```typescript
// Change from:
const jobQueue = InMemoryJobQueue.getInstance();

// To:
const jobQueue = JobQueue.getInstance();
```

4. Set `REDIS_URL` in your `.env` file

## API Endpoints

### Create a prototype MNTL profile
Create a profile before uploading an archive. Handles are unique without
regard to case and may contain 3-30 letters, numbers, or underscores.

**Endpoint**: `POST /api/users`

**Request**:
```json
{ "handle": "mntl_user1" }
```

### Get a prototype MNTL profile

**Endpoint**: `GET /api/users/:userId`

### Get normalized MNTL activity
Returns all likes and comments from the profile's linked archives in a single
common activity format. Known target posts include their normalized type and
owning MNTL profile when that archive is available.

**Endpoint**: `GET /api/users/:userId/activity`

### Upload Archive
Upload a social media archive ZIP file.

**Endpoint**: `POST /api/upload`

**Request**:
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  - `archive`: ZIP file (max 500MB)
  - `mntlUserId`: ID returned when creating the MNTL profile

**Response**:
```json
{
  "success": true,
  "jobId": "job-id",
  "platform": "instagram",
  "message": "Archive uploaded and migration job started"
}
```

### Get deduplicated MNTL connections
Returns one record per linked MNTL profile, with the platforms where selected
archive relationships matched.

**Endpoint**: `GET /api/connections?userId=:mntlUserId`

### Get Job Status
Check the status of a migration job.

**Endpoint**: `GET /api/jobs/:jobId`

**Response**:
```json
{
  "jobId": "job-id",
  "platform": "instagram",
  "status": "processing",
  "progress": 45,
  "startedAt": "2026-10-21T23:00:00.000Z",
  "completedAt": null,
  "error": null,
  "totalPosts": 150,
  "processedPosts": 67
}
```

### Save Archive Selection
Persist selected post IDs, followers, and following names to the archive JSON.
The wizard saves after selection changes and before moving to the next step.

**Endpoint**: `POST /api/archives/:archiveId/selection`

**Request**:
```json
{
  "postIds": ["post-id"],
  "followers": ["follower-name"],
  "following": ["following-name"]
}
```

Selections may contain only IDs and names present in that archive.

### Relationship claims
Saving an archive selection creates one persisted claim for each selected
follower or followed account in that archive JSON. Each claim records the
platform, relationship direction, source and target platform identities, a
stable relationship key for deduplicating claims made from either side, and
the archive/import provenance. Claims are explicitly unverified user-provided
archive evidence; importing one does not create or confirm an MNTL follow.

X identities are matched by exact exported account ID, Instagram and TikTok
identities by a case-insensitive, `@`-independent handle, and Facebook
identities by display name. Identities and relationship keys are stored as
keyed fingerprints, never as plain text (see Privacy). Saving a selection
records the relationship reported by that profile's archive. When the other
account has uploaded a matching archive under a different MNTL profile, the
migration tool shows the discovered MNTL handle and matching platform(s).
Ambiguous platform identities that map to multiple MNTL profiles are not shown
as matches.

Claim records support pending identity match, awaiting confirmation, confirmed,
rejected, and withdrawn states. Accepting or rejecting a discovered connection
is not part of this migration tool; those decisions belong in the MNTL app.
The tool only displays archive-based matches and does not apply follows.

`GET /api/archives/:archiveId/relationship-claims` returns claims generated
from an archive's saved selection. `GET /api/connections?userId=:userId`
returns discovered connections grouped by MNTL profile and matching platform.

### Fetch posts and replies
`GET /api/data/posts` returns non-reply posts and reels. `GET /api/data/replies`
returns replies separately. Both responses include the saved selection, and the
reply records include the parent post ID when the X archive provides it.

### Crossmatching likes to posts
`GET /api/data/likes` returns imported likes. Archive comparisons match likes
first by platform and post identifier. Instagram exports that do not share an
identifier use an exact, normalized caption match only when it identifies one
post uniquely. Unresolved likes remain stored and are checked again whenever
another archive is imported.
For Instagram, the like `postId` is the archive's `fbid` when available; the
URL-derived shortcode is retained separately as `postShortcode`.

`GET /api/data/comments` returns comments included in the uploaded archive.
TikTok imports currently include posts and follower/following lists only; TikTok
likes, comments, and watch history are not imported. Legacy TikTok likes and
comments are excluded from profile activity. `GET /api/users/:userId/activity`
returns likes and comments from supported platform archives linked to a MNTL
profile in one common format. Each activity has a common type, actor, target
post ID/type/text/URL, source platform, and timestamp; known target posts are
enriched with their normalized post type and MNTL owner.

The review page displays matched likes and comments in separate tabs. Unmatched
activity remains stored with its archive and is reconsidered when another
archive is uploaded, but is hidden from these lists to reduce clutter. The
migration tool displays matches, while MNTL decides whether to finalize them.
Likes and comments are not selection controls or transferred directly to MNTL.

The default loader also stores data in process memory, but each completed account
archive is saved locally as a JSON file in `data/archives/`. These files persist
across server restarts and are used for account-to-account comparisons.
Downloaded TikTok videos are stored under `data/media/` alongside their archive
records. Other archive media is served from the retained uploaded archive
through `/api/media`; those uploaded archives must remain available while their
posts are displayed. TikTok export video links are signed and may expire. If a
TikTok video download times out, the archive import continues and keeps the
original URL; the video may not remain available after its signed link expires.

After an archive is processed, the web app guides the user through a three-step
selection wizard: posts (with captions and media), followers, then following.
Follower and following lists can be searched. All items are selected by default,
and each step saves changes to the archive's JSON file before continuing.
The review page groups discovered MNTL matches into one list, showing each
person's MNTL handle, matching platform(s), and relationship direction. The
migration tool has no accept/reject controls; users make those decisions in the
MNTL app. Likes and comments from the profile's uploaded archives appear in
separate tabs using one normalized activity format. The user confirms the
selection to save it and complete the flow. They can then
upload another platform archive;
platforms already uploaded in the same browser tab are excluded from that flow.
Comments are not included in migration comparisons.

Comparisons use archives uploaded to this local tool; an uploaded archive is not
proof that its owner has joined MNTL. The app has no MNTL integration and does
not automatically create follows or transfer likes. It reports candidate
matches based on account identifiers, selected follow lists, and post ID,
shortcode, or unique exact-caption matches.

Each JSON archive contains its owner, platform, import time, follower and
following names, normalized posts (IDs, captions, and media references), and
likes (target IDs, URLs, captions, and shortcodes). Treat both `data/archives/`
and `uploads/` as private account data.

### Health Check
Check if the server is running.

**Endpoint**: `GET /api/health`

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2026-10-21T23:00:00.000Z"
}
```

### Supported Platforms
Get list of supported platforms.

**Endpoint**: `GET /api/platforms`

**Response**:
```json
{
  "platforms": ["instagram", "facebook", "x", "tiktok"]
}
```

## Common Data Model

### Post Schema
```typescript
{
  originalPlatformId: string;
  platform: 'instagram' | 'facebook' | 'x' | 'tiktok';
  postType?: 'post' | 'reel' | 'text';
  isReply?: boolean;
  replyToPostId?: string;
  content?: string;
  mediaUrls?: string[];
  mediaTypes?: ('image' | 'video' | 'none')[];
  createdAt: Date;
  updatedAt?: Date;
  metrics?: {
    likesCount: number;
    commentsCount: number;
    sharesCount: number;
    viewsCount: number;
  };
  hashtags?: string[];
  mentions?: string[];
  location?: string;
  isDeleted: boolean;
}
```

### User Schema
```typescript
{
  originalPlatformId: string;
  platform: 'instagram' | 'facebook' | 'x' | 'tiktok';
  username: string;
  displayName?: string;
  bio?: string;
  profilePictureUrl?: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  verified: boolean;
  joinedAt?: Date;
}
```

## Platform-Specific Handling

### Instagram
- Detects Instagram-specific archive paths rather than generic names such as `posts`
- Parses regular posts and reels, including captions, stable platform identifiers, liked-post URLs/captions, and both array/object follow-list exports
- Joins album photos from split Instagram `posts*.json` export files to their parent post
- Handles media files in `media/` folder, including ZIPs with a top-level export directory
- Existing saved archives should be uploaded again to refresh their stored album media after upgrading
- Extracts hashtags and mentions from captions

### Facebook
- Detects archives by their `your_facebook_activity/` folder
- Repairs Facebook's text encoding (UTF-8 stored as Latin-1 escapes) and reads English and Dutch labels
- Imports posts, standalone photos, videos, and albums; skips trash, archived posts, stickers, and messages
- Friends are both followers and following (friendship is mutual); followed profiles are following only
- Relationship lists only contain display names, so Facebook claims match by display name
- Reactions and comments record the content owner (from the URL, name label, or title), so activity is
  attributed to the owner's MNTL profile even when the exact post is not in their archive

### X (Twitter)
- Detects Twitter-specific archive paths or `tweets.js` files, not generic `data` filenames
- Strips JavaScript wrapper from `.js` files (e.g., `window.YTD.tweets.part0 = [...]`)
- Imports tweets, follower/following account IDs, and liked tweet IDs from standard X archive files
- Identifies replies by their exported parent post ID and presents them in a separately selectable list from posts and reels
- Shows X follower/following handles only when a matching account archive is stored; unknown IDs stay saved but hidden
- Maps photo tweets to regular posts, video tweets to reels, and text-only tweets to text posts
- Serves photo and video files from the uploaded archive when present
- Uses exported account IDs for followers and following, and tweet IDs for likes

### TikTok
- Detects TikTok-specific archive paths or `user_data` exports rather than generic `video` filenames
- Parses TikTok's single-file `user_data_tiktok.json` export for the account profile, the account's own posted videos, followers, and following
- Does not currently import TikTok likes, comments, or watch history
- Downloads only videos listed under `Post.Posts.VideoList` from HTTPS TikTok CDN hosts, then stores the video files under `data/media/` and serves them through `/api/media`
- Keeps downloaded video storage bounded (250 MB per video, 500 MB per archive); download errors fail the import with an explicit job error
- Also supports legacy `video_data.json` and `posts.csv` post exports
- Handles video-specific metrics (views, shares)
- Extracts hashtags and mentions from descriptions

## Privacy

Archives contain data about people who never joined MNTL. The tool keeps only what matching needs:

- **Raw exports are deleted** after import. Only post media is copied out; messages are never extracted.
- **Access is per user.** A signed session cookie is issued when a profile is created, and every
  archive, job, and media request is scoped to its owner. Other users only see media of selected posts.
- **Third-party data is fingerprinted.** Relationship claims, the text of other people's liked posts,
  and the owners of liked or commented content are stored as HMAC fingerprints keyed with
  `FINGERPRINT_SECRET` (or `data/fingerprint.key` if unset). Matching compares fingerprints.
  Losing or changing the key breaks matching for existing data.
- **Comparisons share counts**, not lists of third-party accounts, and never the other user's comment text.
- **Retention.** `POST /api/archives/:archiveId/confirm` (sent when the user confirms their selection)
  deletes unselected followers and following; unconfirmed archives are pruned after 30 days.
  Unconfirmed claims expire after a year. Retention runs at startup and every 6 hours.
- **Opt-out.** `POST /api/opt-out` with `{ "platform": "facebook", "account": "Jane Doe" }` removes that
  identity from all archives and claims and prevents future matches. Only fingerprints are stored.
  It needs no login, so it can only ever remove data.

## Integration with Expo App

### File Upload Flow

1. **File Picker**: Use `expo-document-picker` to select ZIP file
```typescript
import * as DocumentPicker from 'expo-document-picker';

const pickFile = async () => {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/zip',
  });
  if (result.canceled) return;
  return result.assets[0];
};
```

2. **Upload to Server**: Use `FormData` to upload file
```typescript
const uploadArchive = async (fileUri: string, userId: string) => {
  const formData = new FormData();
  formData.append('archive', {
    uri: fileUri,
    type: 'application/zip',
    name: 'archive.zip',
  } as any);
  formData.append('userId', userId);

  const response = await fetch('http://your-server:3000/api/upload', {
    method: 'POST',
    body: formData,
  });

  return response.json();
};
```

3. **Track Progress**: Poll job status endpoint
```typescript
const trackProgress = async (jobId: string) => {
  const response = await fetch(`http://your-server:3000/api/jobs/${jobId}`);
  const data = await response.json();
  return data;
};

// Poll every 2 seconds
setInterval(async () => {
  const status = await trackProgress(jobId);
  console.log(`Progress: ${status.progress}%`);
}, 2000);
```

## Database Setup

### Using In-Memory Loader (Default)
The project includes an `InMemoryDataLoader` for testing and development.

### Using PostgreSQL
To use PostgreSQL:

1. Install dependencies:
```bash
npm install pg
npm install -D @types/pg
```

2. Create tables:
```sql
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  original_platform_id VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  content TEXT,
  media_urls TEXT[],
  media_types TEXT[],
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  metrics JSONB,
  hashtags TEXT[],
  mentions TEXT[],
  location VARCHAR(255),
  is_deleted BOOLEAN DEFAULT FALSE,
  UNIQUE (original_platform_id, platform)
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  original_platform_id VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  username VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  bio TEXT,
  profile_picture_url TEXT,
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  posts_count INTEGER DEFAULT 0,
  verified BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMP,
  UNIQUE (original_platform_id, platform)
);

CREATE TABLE follow_relations (
  id SERIAL PRIMARY KEY,
  follower_id VARCHAR(255) NOT NULL,
  following_id VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  followed_at TIMESTAMP,
  UNIQUE (follower_id, following_id, platform)
);

CREATE TABLE likes (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  post_id VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  liked_at TIMESTAMP,
  post_url TEXT,
  post_text TEXT,
  post_shortcode VARCHAR(255),
  UNIQUE (user_id, post_id, platform)
);

CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  original_platform_id VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  post_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP,
  likes_count INTEGER DEFAULT 0,
  UNIQUE (original_platform_id, platform)
);
```

3. Update `JobQueue.ts` to use `DatabaseLoader` instead of `InMemoryDataLoader`

## Testing

Test the API with curl:

```bash
# Upload archive
curl -X POST \
  http://localhost:3000/api/upload \
  -F "archive=@/path/to/archive.zip" \
  -F "userId=test-user"

# Check job status
curl http://localhost:3000/api/jobs/{jobId}

# Health check
curl http://localhost:3000/api/health

# Supported platforms
curl http://localhost:3000/api/platforms
```

## Error Handling

The tool includes comprehensive error handling:
- Invalid ZIP files are rejected
- Platform detection fails gracefully
- Validation errors are logged but don't stop processing
- Failed jobs are retried with exponential backoff (3 attempts)

## Performance Considerations

- **Streaming**: Large files are processed using streaming to avoid memory issues
- **Job Queue**: Background processing prevents blocking HTTP requests
- **Batch Operations**: Database inserts are batched for efficiency
- **Deduplication**: Prevents duplicate entries using unique constraints

### Queue Selection

**In-Memory Queue (Development)**
- No external dependencies
- Jobs are stored in memory
- Perfect for single-instance development
- Jobs are lost on server restart

**BullMQ with Redis (Production)**
- Requires Redis server
- Persistent job storage
- Supports multiple workers
- Retry logic with exponential backoff
- Job priorities and delays

## License

ISC
