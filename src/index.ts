import 'dotenv/config';
import { app } from './api/server';
import { InMemoryJobQueue } from './queue/InMemoryJobQueue';

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
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
