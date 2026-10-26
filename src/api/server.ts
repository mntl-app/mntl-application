import express, { Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import AdmZip from 'adm-zip';
import { InMemoryJobQueue } from '../queue/InMemoryJobQueue';
import { ZipExtractor } from '../etl/extract/ZipExtractor';
import { AdapterFactory } from '../adapters/AdapterFactory';
import { ArchiveStore, StoredArchive } from '../etl/load/ArchiveStore';

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
const mediaArchives = new Map<string, string>();
const archiveStore = new ArchiveStore();
const serverInstanceId = randomUUID();
const uploadsDir = path.join(process.cwd(), 'uploads');

if (fs.existsSync(uploadsDir)) {
  for (const file of fs.readdirSync(uploadsDir)) {
    if (file.endsWith('.zip') || /^[a-f0-9]{32}$/i.test(file)) {
      mediaArchives.set(path.basename(file), path.join(uploadsDir, file));
    }
  }
}

async function getRequestedArchive(req: Request, res: Response): Promise<StoredArchive | null> {
  const archiveId = typeof req.query.archiveId === 'string' ? req.query.archiveId : undefined;
  if (archiveId) {
    const archive = await archiveStore.get(archiveId);
    if (!archive) res.status(404).json({ error: 'Stored archive not found' });
    return archive;
  }
  return (await archiveStore.list())[0] || null;
}

app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

app.post('/api/upload', upload.single('archive'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const zipPath = req.file.path;
    const isValid = await ZipExtractor.validateZip(zipPath);

    if (!isValid) {
      fs.unlinkSync(zipPath);
      return res.status(400).json({ error: 'Invalid ZIP file' });
    }

    const adapter = AdapterFactory.getAdapter(zipPath);
    if (!adapter) {
      fs.unlinkSync(zipPath);
      return res.status(400).json({ error: 'Unable to detect platform from archive' });
    }

    let uploadedPlatforms: unknown = [];
    if (typeof req.body.uploadedPlatforms === 'string') {
      try {
        uploadedPlatforms = JSON.parse(req.body.uploadedPlatforms);
      } catch {
        fs.unlinkSync(zipPath);
        return res.status(400).json({ error: 'Invalid uploaded platform list' });
      }
    }
    if (
      !Array.isArray(uploadedPlatforms) ||
      uploadedPlatforms.some(platform => typeof platform !== 'string')
    ) {
      fs.unlinkSync(zipPath);
      return res.status(400).json({ error: 'Invalid uploaded platform list' });
    }
    if (uploadedPlatforms.includes(adapter.platform)) {
      fs.unlinkSync(zipPath);
      return res.status(409).json({
        error: `${adapter.platform} has already been uploaded in this migration flow`,
      });
    }
    if (
      typeof req.body.serverInstanceId === 'string' &&
      req.body.serverInstanceId !== serverInstanceId
    ) {
      fs.unlinkSync(zipPath);
      return res.status(409).json({
        error: 'The server restarted. Refresh the page to start a new migration flow.',
      });
    }

    const userId = req.body.userId || 'anonymous';
    const jobId = await jobQueue.addMigrationJob({
      zipPath,
      userId,
      platform: adapter.platform,
    });
    mediaArchives.set(path.basename(zipPath), zipPath);

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

app.get('/api/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const jobStatus = await jobQueue.getJobStatus(Array.isArray(jobId) ? jobId[0] : jobId);

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

app.post('/api/archives/:archiveId/selection', async (req: Request, res: Response) => {
  try {
    const archiveId = Array.isArray(req.params.archiveId) ? req.params.archiveId[0] : req.params.archiveId;
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

app.get('/api/data/posts', async (req: Request, res: Response) => {
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

app.get('/api/data/replies', async (req: Request, res: Response) => {
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

app.get('/api/data/users', (req: Request, res: Response) => {
  try {
    const dataLoader = jobQueue.getDataLoader();
    const users = dataLoader.getUsers();
    res.json({ users, count: users.length });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/data/followers', async (req: Request, res: Response) => {
  try {
    const archive = await getRequestedArchive(req, res);
    if (res.headersSent) return;
    const knownHandles = archive
      ? await archiveStore.getKnownOwnerHandles(archive.platform)
      : new Map<string, string>();
    const allFollowRelations = archive
      ? archive.followers.map(followerId => ({
          followerId,
          followingId: archive.ownerId,
          platform: archive.platform,
          accountHandle: knownHandles.get(followerId),
        }))
      : [];
    const followRelations = archive?.platform === 'x'
      ? allFollowRelations.filter(relation => relation.accountHandle)
      : allFollowRelations;
    res.json({
      followRelations,
      count: followRelations.length,
      hiddenCount: allFollowRelations.length - followRelations.length,
      selectionCatalog: { followers: archive?.followers || [] },
      selection: archive?.selection,
    });
  } catch (error) {
    console.error('Error fetching followers:', error);
    res.status(500).json({ error: 'Failed to fetch followers' });
  }
});

app.get('/api/data/following', async (req: Request, res: Response) => {
  try {
    const archive = await getRequestedArchive(req, res);
    if (res.headersSent) return;
    const knownHandles = archive
      ? await archiveStore.getKnownOwnerHandles(archive.platform)
      : new Map<string, string>();
    const allFollowRelations = archive
      ? archive.following.map(followingId => ({
          followerId: archive.ownerId,
          followingId,
          platform: archive.platform,
          accountHandle: knownHandles.get(followingId),
        }))
      : [];
    const followRelations = archive?.platform === 'x'
      ? allFollowRelations.filter(relation => relation.accountHandle)
      : allFollowRelations;
    res.json({
      followRelations,
      count: followRelations.length,
      hiddenCount: allFollowRelations.length - followRelations.length,
      selectionCatalog: { following: archive?.following || [] },
      selection: archive?.selection,
    });
  } catch (error) {
    console.error('Error fetching following:', error);
    res.status(500).json({ error: 'Failed to fetch following' });
  }
});

app.get('/api/data/likes', async (req: Request, res: Response) => {
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

app.get('/api/data/summary', async (req: Request, res: Response) => {
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
      likes: archive?.likes.length || 0,
    };
    res.json(summary);
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

app.post('/api/compare', async (req: Request, res: Response) => {
  try {
    const archiveId = typeof req.body.archiveId === 'string' ? req.body.archiveId : '';
    if (!archiveId) return res.status(400).json({ error: 'Archive ID is required' });
    const comparisons = await archiveStore.compare(archiveId);
    res.json({ archiveId, comparisons, count: comparisons.length });
  } catch (error) {
    console.error('Archive comparison error:', error);
    const isMissing = error instanceof Error && error.message.startsWith('Stored archive not found:');
    res.status(isMissing ? 404 : 500).json({ error: isMissing ? 'Stored archive not found' : 'Failed to compare archives' });
  }
});

// Serve media entries from uploaded ZIP archives retained for post display.
app.get('/api/media', (req: Request, res: Response) => {
  try {
    const archiveId = typeof req.query.archiveId === 'string' ? req.query.archiveId : '';
    const entryName = typeof req.query.entry === 'string' ? req.query.entry : '';
    const zipPath = mediaArchives.get(archiveId);
    if (!zipPath || !entryName) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    const normalizedEntryName = entryName.replace(/\\/g, '/');
    const isSupportedMediaPath = normalizedEntryName.startsWith('media/') ||
      normalizedEntryName.startsWith('data/tweets_media/');
    if (
      !isSupportedMediaPath ||
      normalizedEntryName.split('/').some(segment => segment === '.' || segment === '..')
    ) {
      return res.status(404).json({ error: 'Media file not found' });
    }

    const zip = new AdmZip(zipPath);
    const exactEntry = zip.getEntry(normalizedEntryName);
    const matchingEntries = exactEntry ? [exactEntry] : zip.getEntries().filter(zipEntry =>
      !zipEntry.isDirectory &&
      zipEntry.entryName.replace(/\\/g, '/').endsWith(`/${normalizedEntryName}`)
    );
    const entry = matchingEntries.length === 1 ? matchingEntries[0] : undefined;
    if (!entry || entry.isDirectory) {
      return res.status(404).json({ error: 'Media file not found' });
    }

    const ext = path.extname(entryName).toLowerCase();
    const contentType: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
    };
    res.setHeader('Content-Type', contentType[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(entry.getData());
  } catch (error) {
    console.error('Error serving media:', error);
    return res.status(500).json({ error: 'Failed to serve media' });
  }
});

export { app };
