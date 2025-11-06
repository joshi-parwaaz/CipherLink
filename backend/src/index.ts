import http from 'http';
import { createApp } from './api/server.js';
import { setupSocket } from './realtime/socket.js';
import { connectToMongo } from './config/mongo.js';
import { initGridFS } from './services/attachments.service.js';
import { config } from './config/index.js';
import logger from './utils/logger.js';
import { Server as SocketIOServer } from 'socket.io';

// Export io instance for use in routes
export let io: SocketIOServer;

async function start() {
  try {
    // Connect to MongoDB
    await connectToMongo();

    // Initialize GridFS
    initGridFS();

    // Create Express app
    const app = createApp();
    const httpServer = http.createServer(app);
    io = setupSocket(httpServer);

    httpServer.listen(config.port, () => {
      logger.info(`🚀 CypherText backend listening on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
    });
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();
