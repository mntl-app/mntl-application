import 'dotenv/config';
import { clearDevelopmentArchives } from './etl/load/DevelopmentArchiveCleanup';

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    if (process.env.NODE_ENV === 'development') {
      const removedCount = await clearDevelopmentArchives();
      console.log(`Development startup cleared ${removedCount} stored archive file(s)`);
    }

    const { app } = await import('./api/server');
    const { InMemoryJobQueue } = await import('./queue/InMemoryJobQueue');
    const jobQueue = InMemoryJobQueue.getInstance();

    app.listen(PORT, () => {
      console.log(`Migration server running on port ${PORT}`);
      console.log(`Supported platforms: instagram, facebook, x, tiktok`);
    });

    process.on('SIGINT', async () => {
      console.log('Shutting down gracefully...');
      await jobQueue.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('Shutting down gracefully...');
      await jobQueue.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
