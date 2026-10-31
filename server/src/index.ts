import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { runMigrations } from './database/migrations';
import { initializeStorageDirectories } from './utils/storage';
import { socketService } from './services/socketService';
import { errorHandler } from './middleware/errorHandler';
import { authHandler } from './middleware/authHandler';

import documentRoutes from './routes/documentRoutes';
import queueRoutes from './routes/queueRoutes';
import printerRoutes from './routes/printerRoutes';
import serverRoutes from './routes/serverRoutes';
import costRoutes from './routes/costRoutes';
import settingsRoutes from './routes/settingsRoutes';
import { queueWorker } from './workers/queueWorker';

dotenv.config();

const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('   PaperPilot – Local Android Printing Server       ');
  console.log('   Hardware Target: HP Smart Tank 580 (Wi-Fi Direct)');
  console.log('----------------------------------------------------');

  // 1. Initialize local filesystem storage
  initializeStorageDirectories();

  // 2. Initialize SQLite database & migrations
  await runMigrations();

  // 3. Create Express App & HTTP Server
  const app = express();
  const server = http.createServer(app);

  // 4. Configure Socket.IO
  socketService.init(server);

  // 5. Middleware
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Request logger
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
    });
    next();
  });

  // Security & Authentication Handler
  app.use('/api', authHandler);

  // 6. Mount REST API Routes
  app.use('/api/documents', documentRoutes);
  app.use('/api/queue', queueRoutes);
  app.use('/api/printers', printerRoutes);
  app.use('/api/server', serverRoutes);
  app.use('/api/cost', costRoutes);
  app.use('/api/settings', settingsRoutes);

  // Root welcome / health ping
  app.get('/', (req, res) => {
    res.json({
      name: 'PaperPilot Server',
      version: '1.0.0',
      status: 'operational',
      target: 'HP Smart Tank 580',
      docs: '/api/server/health',
    });
  });

  // Global Error Handler
  app.use(errorHandler);

  // 7. Start Listening
  server.listen(PORT, HOST, async () => {
    console.log(`[Server] Listening on http://${HOST}:${PORT}`);
    console.log(`[Server] Local Android loopback accessible at http://127.0.0.1:${PORT}`);

    // Start persistent print queue worker
    await queueWorker.start();
  });

  // 8. Graceful Shutdown
  const handleShutdown = (signal: string) => {
    console.log(`[Server] Received ${signal}. Starting graceful shutdown...`);
    queueWorker.stop();
    server.close(() => {
      console.log('[Server] HTTP and WebSocket connections terminated.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[Server] Forced shutdown after timeout.');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Server] Fatal startup failure:', err);
  process.exit(1);
});
