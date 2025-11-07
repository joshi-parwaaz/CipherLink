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
        const userRoom = `user:${userId}`;
        const deviceRoom = `device:${deviceId}`;
        socket.join(userRoom);
        socket.join(deviceRoom);
        logger.info(
          { 
            socketId: socket.id, 
            userId, 
            deviceId,
            rooms: [userRoom, deviceRoom]
          }, 
          'Client registered for notifications - joined rooms'
        );
      } else {
        logger.warn({ socketId: socket.id, data }, 'Invalid register data - missing userId or deviceId');
      }
    });

    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Client disconnected');
    });
  });

  return io;
}
