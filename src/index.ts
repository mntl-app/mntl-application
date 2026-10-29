import 'dotenv/config';
import { clearDevelopmentArchives } from './etl/load/DevelopmentArchiveCleanup';

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    if (process.env.NODE_ENV === 'development') {
      const removedCount = await clearDevelopmentArchives();
      console.log(`Development startup cleared ${removedCount} managed archive/media item(s)`);
    }

    const { app } = await import('./api/server');
    const { ArchiveStore } = await import('./etl/load/ArchiveStore');
    const archiveStore = new ArchiveStore();
    const applyRetention = () => archiveStore.applyRetention()
      .then(count => count && console.log(`Retention updated ${count} archive(s)`))
      .catch(error => console.error('Retention failed:', error));
    await applyRetention();
    setInterval(applyRetention, 6 * 60 * 60 * 1000).unref();
    const { InMemoryJobQueue } = await import('./queue/InMemoryJobQueue');
    const jobQueue = InMemoryJobQueue.getInstance();

    app.listen(PORT, () => {
      console.log(`Migration server running on port ${PORT}`);
      console.log(`Supported platforms: instagram, facebook, x, tiktok`);
    });

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, async () => {
        console.log('Shutting down gracefully...');
        await jobQueue.close();
        process.exit(0);
      });
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
