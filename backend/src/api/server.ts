import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import logger from '../utils/logger.js';
import { config } from '../config/index.js';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import conversationsRoutes from './routes/conversations.routes.js';
import messagesRoutes from './routes/messages.routes.js';
import receiptsRoutes from './routes/receipts.routes.js';
import attachmentsRoutes from './routes/attachments.routes.js';
import devicesRoutes from './routes/devices.routes.js';
import prekeysRoutes from './routes/prekeys.routes.js';
import recentLogs from '../utils/recentLogs.js';

export function createApp(): Express {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: true }));

  // Logging middleware (meta-only)
  app.use(pinoHttp({ logger }));

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Routes
  app.use('/api', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/conversations', conversationsRoutes);
  app.use('/api/messages', messagesRoutes);
  app.use('/api/receipts', receiptsRoutes);
  app.use('/api/attachments', attachmentsRoutes);
  app.use('/api/devices', devicesRoutes);
  app.use('/api/prekeys', prekeysRoutes);

  // Debug: expose recent logs for easy copy/paste during local development
  if (process.env.NODE_ENV === 'development') {
    app.get('/debug/logs', (req, res) => {
      const limit = parseInt(req.query.limit as string) || 200;
      res.json({ logs: recentLogs.getRecentLogs(limit) });
    });
  }

  return app;
}
