import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import logger from '../utils/logger.js';

export function setupSocket(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Client connected');

    // Register device for real-time notifications
    socket.on('register', (data: { userId: string; deviceId: string }) => {
      const { userId, deviceId } = data;
      if (userId && deviceId) {
        socket.join(`user:${userId}`);
        socket.join(`device:${deviceId}`);
        logger.info({ socketId: socket.id, userId, deviceId }, 'Client registered for notifications');
      }
    });

    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Client disconnected');
    });
  });

  return io;
}
