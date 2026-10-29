import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { InMemoryJobQueue } from '../queue/InMemoryJobQueue';
import { ZipExtractor } from '../etl/extract/ZipExtractor';
import { AdapterFactory } from '../adapters/AdapterFactory';
import { ArchiveStore, StoredArchive } from '../etl/load/ArchiveStore';
import { MntlUser, MntlUserStore } from '../etl/load/MntlUserStore';
import { storedMediaPath } from '../etl/extract/MediaExtractor';
import { getSessionUserId, getSessionUserIds, setSessionUser } from './session';
import { PlatformEnum } from '../types/schemas';

const app = express();
const upload = multer({
  dest: './uploads',
  limits: {
    fileSize: 500 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.zip') {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'));
    }
  },
});

const jobQueue = InMemoryJobQueue.getInstance();
const archiveStore = new ArchiveStore();
const mntlUserStore = new MntlUserStore();
const serverInstanceId = randomUUID();

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

type AuthenticatedResponse = Response<any, { user: MntlUser }>;

async function requireSession(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getSessionUserId(req);
    const user = userId ? await mntlUserStore.getById(userId) : null;
    if (!user) return res.status(401).json({ error: 'Create a MNTL profile to continue' });
    res.locals.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

// Archives are only visible to the MNTL profile that uploaded them; others get a 404.
async function getOwnedArchive(archiveId: string, user: MntlUser): Promise<StoredArchive | null> {
  try {
    const archive = await archiveStore.get(archiveId);
    return archive?.mntlUserId === user.userId ? archive : null;
  } catch {
    return null;
  }
}

async function getRequestedArchive(req: Request, res: AuthenticatedResponse): Promise<StoredArchive | null> {
  const user = res.locals.user;
  const archiveId = typeof req.query.archiveId === 'string' ? req.query.archiveId : undefined;
  if (archiveId) {
    const archive = await getOwnedArchive(archiveId, user);
    if (!archive) res.status(404).json({ error: 'Stored archive not found' });
    return archive;
  }
  return (await archiveStore.list()).find(archive => archive.mntlUserId === user.userId) || null;
}

app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  const isPublic = (req.method === 'POST' && ['/users', '/opt-out'].includes(req.path)) ||
    (req.method === 'GET' && ['/health', '/platforms', '/session'].includes(req.path));
  // Media is loaded by <img> and <video> tags, which cannot name a profile.
  const isMedia = req.method === 'GET' && req.path === '/media';
  if (isPublic) return next();
  if (isMedia) {
    return getSessionUserIds(req).length
      ? next()
      : res.status(401).json({ error: 'Create a MNTL profile to continue' });
  }
  return requireSession(req, res, next);
});

app.post('/api/users', async (req: Request, res: Response) => {
  try {
    if (typeof req.body.handle !== 'string') {
      return res.status(400).json({ error: 'MNTL handle is required' });
    }
    const user = await mntlUserStore.create(req.body.handle);
    setSessionUser(res, user.userId);
    return res.status(201).json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('MNTL handle must be')) {
      return res.status(400).json({ error: message });
    }
    if (message === 'That MNTL handle is already taken') {
      return res.status(409).json({ error: message });
    }
    console.error('MNTL user creation error:', error);
    return res.status(500).json({ error: 'Failed to create MNTL profile' });
  }
});

app.get('/api/users/:userId', (req: Request, res: AuthenticatedResponse) => {
  const { user } = res.locals;
  if (routeParam(req.params.userId) !== user.userId) {
    return res.status(404).json({ error: 'MNTL profile not found' });
  }
  return res.json({ user });
});

app.get('/api/users/:userId/activity', async (req: Request, res: AuthenticatedResponse) => {
  try {
    const { user } = res.locals;
    if (routeParam(req.params.userId) !== user.userId) {
      return res.status(404).json({ error: 'MNTL profile not found' });
    }
    const activities = await archiveStore.getMntlActivities(user.userId);
    return res.json({
      activities,
      count: activities.length,
    });
  } catch (error) {
    console.error('MNTL activity lookup error:', error);
    return res.status(500).json({ error: 'Failed to fetch MNTL activity' });
  }
});

app.post('/api/upload', upload.single('archive'), async (req: Request, res: AuthenticatedResponse) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const zipPath = req.file.path;
    const reject = (status: number, error: string) => {
      fs.unlinkSync(zipPath);
      return res.status(status).json({ error });
    };

    if (
      typeof req.body.serverInstanceId === 'string' &&
      req.body.serverInstanceId !== serverInstanceId
    ) {
      return reject(409, 'The server restarted. Refresh the page to start a new migration flow.');
    }

    let uploadedPlatforms: unknown = [];
    if (typeof req.body.uploadedPlatforms === 'string') {
      try {
        uploadedPlatforms = JSON.parse(req.body.uploadedPlatforms);
      } catch {
        return reject(400, 'Invalid uploaded platform list');
      }
    }
    if (
      !Array.isArray(uploadedPlatforms) ||
      uploadedPlatforms.some(platform => typeof platform !== 'string')
    ) {
      return reject(400, 'Invalid uploaded platform list');
    }

    const mntlUser = res.locals.user;

    if (!(await ZipExtractor.validateZip(zipPath))) {
      return reject(400, 'Invalid ZIP file');
    }

    const adapter = AdapterFactory.getAdapter(zipPath);
    if (!adapter) {
      return reject(400, 'Unable to detect platform from archive');
    }
    if (uploadedPlatforms.includes(adapter.platform)) {
      return reject(409, `${adapter.platform} has already been uploaded in this migration flow`);
    }

    const jobId = await jobQueue.addMigrationJob({
      zipPath,
      userId: mntlUser.userId,
      mntlUserId: mntlUser.userId,
      mntlHandle: mntlUser.handle,
      platform: adapter.platform,
    });

    res.json({
      success: true,
      jobId,
      archiveId: path.basename(zipPath),
      platform: adapter.platform,
      message: 'Archive uploaded and migration job started',
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to process upload' });
  }
});

app.get('/api/jobs/:jobId', async (req: Request, res: AuthenticatedResponse) => {
  try {
    const jobId = routeParam(req.params.jobId);
    const jobStatus = jobQueue.getJobOwnerId(jobId) === res.locals.user.userId
      ? await jobQueue.getJobStatus(jobId)
      : null;

    if (!jobStatus) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(jobStatus);
  } catch (error) {
    console.error('Job status error:', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/platforms', (req: Request, res: Response) => {
  const adapters = AdapterFactory.getAllAdapters();
  const platforms = adapters.map(adapter => adapter.platform);
  res.json({ platforms });
});

app.get('/api/session', (req: Request, res: Response) => {
  const adapters = AdapterFactory.getAllAdapters();
  res.json({
    serverInstanceId,
    platforms: adapters.map(adapter => adapter.platform),
  });
});

app.post('/api/archives/:archiveId/selection', async (req: Request, res: AuthenticatedResponse) => {
  try {
    const archiveId = routeParam(req.params.archiveId);
    if (!(await getOwnedArchive(archiveId, res.locals.user))) {
      return res.status(404).json({ error: 'Stored archive not found' });
    }
    const selection = await archiveStore.saveSelection(archiveId, req.body);
    res.json({ archiveId, selection: selection.selection });
  } catch (error) {
    console.error('Archive selection error:', error);
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('Stored archive not found:')) {
      return res.status(404).json({ error: 'Stored archive not found' });
    }
    if (message.includes('Selection contains') || message.includes('Invalid archive')) {
      return res.status(400).json({ error: message });
    }
    return res.status(500).json({ error: 'Failed to save archive selection' });
  }
});

app.post('/api/archives/:archiveId/confirm', async (req: Request, res: AuthenticatedResponse) => {
  try {
    const archiveId = routeParam(req.params.archiveId);
    if (!(await getOwnedArchive(archiveId, res.locals.user))) {
      return res.status(404).json({ error: 'Stored archive not found' });
    }
    const archive = await archiveStore.confirmSelection(archiveId);
    res.json({ archiveId, selectionConfirmedAt: archive.selectionConfirmedAt });
  } catch (error) {
    console.error('Archive confirmation error:', error);
    res.status(500).json({ error: 'Failed to confirm archive selection' });
  }
});

// Lets people who are not MNTL users ask not to be matched. Anyone can submit this,
// so it can only ever remove data, never reveal it.
app.post('/api/opt-out', async (req: Request, res: Response) => {
  try {
    const platform = PlatformEnum.safeParse(req.body.platform);
    const account = typeof req.body.account === 'string' ? req.body.account.trim() : '';
    if (!platform.success || !account || account.length > 200) {
      return res.status(400).json({ error: 'A platform and account name are required' });
    }
    await archiveStore.optOut(platform.data, account);
    res.status(202).json({ success: true });
  } catch (error) {
    console.error('Opt-out error:', error);
    res.status(500).json({ error: 'Failed to record opt-out' });
  }
});

app.get('/api/archives/:archiveId/relationship-claims', async (req: Request, res: AuthenticatedResponse) => {
  try {
    const archiveId = routeParam(req.params.archiveId);
    const archive = await getOwnedArchive(archiveId, res.locals.user);
    if (!archive) return res.status(404).json({ error: 'Stored archive not found' });
    const relationshipClaims = archive.relationshipClaims || [];
    res.json({ archiveId, relationshipClaims, count: relationshipClaims.length });
  } catch (error) {
    console.error('Error fetching relationship claims:', error);
    res.status(500).json({ error: 'Failed to fetch relationship claims' });
  }
});

app.get('/api/data/posts', async (req: Request, res: AuthenticatedResponse) => {
  try {
    const archive = await getRequestedArchive(req, res);
    if (res.headersSent) return;
    const posts = archive?.posts.filter(post => !post.isReply) || [];
    res.json({ posts, count: posts.length, selection: archive?.selection });
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.get('/api/data/replies', async (req: Request, res: AuthenticatedResponse) => {
  try {
    const archive = await getRequestedArchive(req, res);
    if (res.headersSent) return;
    const replies = archive?.posts.filter(post => post.isReply) || [];
    res.json({ replies, count: replies.length, selection: archive?.selection });
  } catch (error) {
    console.error('Error fetching replies:', error);
    res.status(500).json({ error: 'Failed to fetch replies' });
  }
});

function followRelationsHandler(direction: 'followers' | 'following' | 'friends') {
  return async (req: Request, res: AuthenticatedResponse) => {
    try {
      const archive = await getRequestedArchive(req, res);
      if (res.headersSent) return;
      const knownHandles = archive
        ? await archiveStore.getKnownOwnerHandles(archive.platform)
        : new Map<string, string>();
      const accountIds = archive?.[direction] || [];
      // Friends are listed like accounts the owner follows, marked as friendships.
      const allFollowRelations = archive
        ? accountIds.map(accountId => ({
            followerId: direction === 'followers' ? accountId : archive.ownerId,
            followingId: direction === 'followers' ? archive.ownerId : accountId,
            platform: archive.platform,
            accountHandle: knownHandles.get(accountId),
            ...(direction === 'friends' ? { relationship: 'friend' } : {}),
          }))
        : [];
      const followRelations = archive?.platform === 'x'
        ? allFollowRelations.filter(relation => relation.accountHandle)
        : allFollowRelations;
      res.json({
        followRelations,
        count: followRelations.length,
        hiddenCount: allFollowRelations.length - followRelations.length,
        selectionCatalog: { [direction]: accountIds },
        selection: archive?.selection,
      });
    } catch (error) {
      console.error(`Error fetching ${direction}:`, error);
      res.status(500).json({ error: `Failed to fetch ${direction}` });
    }
  };
}

app.get('/api/data/followers', followRelationsHandler('followers'));
app.get('/api/data/following', followRelationsHandler('following'));
app.get('/api/data/friends', followRelationsHandler('friends'));

app.get('/api/data/likes', async (req: Request, res: AuthenticatedResponse) => {
  try {
    const archive = await getRequestedArchive(req, res);
    if (res.headersSent) return;
    const likes = archive?.likes || [];
    res.json({ likes, count: likes.length });
  } catch (error) {
    console.error('Error fetching likes:', error);
    res.status(500).json({ error: 'Failed to fetch likes' });
  }
});

app.get('/api/data/comments', async (req: Request, res: AuthenticatedResponse) => {
  try {
    const archive = await getRequestedArchive(req, res);
    if (res.headersSent) return;
    const comments = archive?.comments || [];
    res.json({ comments, count: comments.length });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

app.get('/api/data/summary', async (req: Request, res: AuthenticatedResponse) => {
  try {
    const archive = await getRequestedArchive(req, res);
    if (res.headersSent) return;
    const summary = {
      platform: archive?.platform,
      ownerId: archive?.ownerId,
      ownerHandle: archive?.ownerHandle,
      posts: archive?.posts.length || 0,
      followers: archive?.followers.length || 0,
      following: archive?.following.length || 0,
      friends: archive?.friends?.length || 0,
      warnings: archive?.importWarnings || [],
      likes: archive?.likes.length || 0,
      comments: archive?.comments?.length || 0,
    };
    res.json(summary);
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

app.post('/api/compare', async (req: Request, res: AuthenticatedResponse) => {
  try {
    const archiveId = typeof req.body.archiveId === 'string' ? req.body.archiveId : '';
    if (!archiveId) return res.status(400).json({ error: 'Archive ID is required' });
    if (!(await getOwnedArchive(archiveId, res.locals.user))) {
      return res.status(404).json({ error: 'Stored archive not found' });
    }
    const comparisons = await archiveStore.compare(archiveId);
    res.json({ archiveId, comparisons, count: comparisons.length });
  } catch (error) {
    console.error('Archive comparison error:', error);
    const isMissing = error instanceof Error && error.message.startsWith('Stored archive not found:');
    res.status(isMissing ? 404 : 500).json({ error: isMissing ? 'Stored archive not found' : 'Failed to compare archives' });
  }
});

app.get('/api/connections', async (req: Request, res: AuthenticatedResponse) => {
  try {
    const connections = await archiveStore.getMntlConnections(res.locals.user.userId);
    return res.json({ connections, count: connections.length });
  } catch (error) {
    console.error('MNTL connection lookup error:', error);
    return res.status(500).json({ error: 'Failed to fetch MNTL connections' });
  }
});

const MEDIA_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

// Serve post media extracted into local storage at import. Other MNTL users may
// only see media from posts the owner selected for migration.
app.get('/api/media', async (req: Request, res: Response) => {
  try {
    const archiveId = typeof req.query.archiveId === 'string' ? req.query.archiveId : '';
    const entryName = typeof req.query.entry === 'string' ? req.query.entry : '';
    const mediaPath = storedMediaPath(archiveId, entryName);
    const archive = mediaPath ? await archiveStore.get(archiveId) : null;
    const mediaUrl = `/api/media?archiveId=${encodeURIComponent(archiveId)}&entry=${encodeURIComponent(entryName)}`;
    const sessionUserIds = getSessionUserIds(req);
    const isVisible = archive && (
      (archive.mntlUserId && sessionUserIds.includes(archive.mntlUserId)) ||
      archive.posts.some(post =>
        archive.selection?.postIds.includes(post.originalPlatformId) &&
        post.mediaUrls?.includes(mediaUrl)
      )
    );
    if (!mediaPath || !isVisible || !fs.existsSync(mediaPath)) {
      return res.status(404).json({ error: 'Media file not found' });
    }

    const ext = path.extname(mediaPath).toLowerCase();
    res.setHeader('Content-Type', MEDIA_CONTENT_TYPES[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.sendFile(mediaPath);
  } catch (error) {
    console.error('Error serving media:', error);
    return res.status(500).json({ error: 'Failed to serve media' });
  }
});

export { app };
