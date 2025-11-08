import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';
import { pushRecentLog } from '../utils/recentLogs.js';
import { config } from '../config/index.js';
import { markMessageDelivered, markMessageFailed } from '../services/delivery.service.js';

// Export io instance for use in routes
export let io: SocketIOServer;

export function setupSocket(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.NODE_ENV === 'development' ? true : (process.env.CORS_ORIGIN || 'http://localhost:5173'),
      credentials: true,
    },
  });

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      logger.warn({ socketId: socket.id }, 'WebSocket connection rejected: no token');
      return next(new Error('Authentication error'));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as any;
      socket.data.userId = decoded.userId;
      socket.data.deviceId = decoded.deviceId;
      logger.info({ socketId: socket.id, userId: decoded.userId, deviceId: decoded.deviceId }, 'WebSocket authenticated');
      next();
    } catch (err) {
      logger.warn({ socketId: socket.id, err }, 'WebSocket authentication failed');
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id, userId: socket.data.userId, deviceId: socket.data.deviceId }, 'Client connected');

    // Auto-register device for real-time notifications using authenticated data
    const userId = socket.data.userId;
    const deviceId = socket.data.deviceId;
    
    if (userId && deviceId) {
      socket.join(`user:${userId}`);
      socket.join(`device:${deviceId}`);
      
      // Log registration and room membership for debugging
      try {
        const userRoom = io.sockets.adapter.rooms.get(`user:${userId}`);
        const deviceRoom = io.sockets.adapter.rooms.get(`device:${deviceId}`);
        logger.info(
          {
            socketId: socket.id,
            userId,
            deviceId,
            socketRooms: Array.from(socket.rooms || []),
            userRoomCount: userRoom ? userRoom.size : 0,
            deviceRoomCount: deviceRoom ? deviceRoom.size : 0,
          },
          'Client auto-registered for notifications'
        );
        pushRecentLog('info', 'Client auto-registered for notifications', {
          socketId: socket.id,
          userId,
          deviceId,
          socketRooms: Array.from(socket.rooms || []),
          userRoomCount: userRoom ? userRoom.size : 0,
          deviceRoomCount: deviceRoom ? deviceRoom.size : 0,
        });
      } catch (err) {
        logger.info({ socketId: socket.id, userId, deviceId }, 'Client auto-registered for notifications');
      }
    }

    // Still allow manual register for compatibility
    socket.on('register', (data: { userId: string; deviceId: string }) => {
      const { userId: manualUserId, deviceId: manualDeviceId } = data;
      if (manualUserId && manualDeviceId) {
        // Only allow if it matches the authenticated data
        if (manualUserId === socket.data.userId && manualDeviceId === socket.data.deviceId) {
          socket.join(`user:${manualUserId}`);
          socket.join(`device:${manualDeviceId}`);
          logger.info({ socketId: socket.id, userId: manualUserId, deviceId: manualDeviceId }, 'Client manually registered for notifications');
        } else {
          logger.warn({ socketId: socket.id, requestedUserId: manualUserId, requestedDeviceId: manualDeviceId, authUserId: socket.data.userId, authDeviceId: socket.data.deviceId }, 'Manual registration rejected: does not match authenticated user');
        }
      }
    });

    // Handle joining conversation rooms
    socket.on('conversation:join', (data: { conversationId: string }) => {
      const { conversationId } = data;
      socket.join(`conversation:${conversationId}`);
      logger.info({ socketId: socket.id, userId: socket.data.userId, conversationId }, 'Socket joined conversation room');
    });

    // Handle leaving conversation rooms
    socket.on('conversation:leave', (data: { conversationId: string }) => {
      const { conversationId } = data;
      socket.leave(`conversation:${conversationId}`);
      logger.info({ socketId: socket.id, userId: socket.data.userId, conversationId }, 'Socket left conversation room');
    });

    // Handle message acknowledgments
    socket.on('ack', async (data: { messageId: string }) => {
      const { messageId } = data;
      const deviceId = socket.data.deviceId;
      const userId = socket.data.userId;

      if (!deviceId || !userId) {
        logger.warn({ socketId: socket.id }, 'ACK received but no device/user ID');
        return;
      }

      try {
        const success = await markMessageDelivered(messageId, deviceId);
        if (success) {
          logger.info({ socketId: socket.id, userId, deviceId, messageId }, 'Message ACK processed');
        } else {
          logger.warn({ socketId: socket.id, userId, deviceId, messageId }, 'Message ACK failed - message not found');
        }
      } catch (err) {
        logger.error({ err, socketId: socket.id, userId, deviceId, messageId }, 'Error processing ACK');
      }
    });

    // Handle message negative acknowledgments
    socket.on('nack', async (data: { messageId: string; reason?: string }) => {
      const { messageId, reason } = data;
      const deviceId = socket.data.deviceId;
      const userId = socket.data.userId;

      if (!deviceId || !userId) {
        logger.warn({ socketId: socket.id }, 'NACK received but no device/user ID');
        return;
      }

      try {
        const success = await markMessageFailed(messageId, deviceId, reason);
        if (success) {
          logger.info({ socketId: socket.id, userId, deviceId, messageId, reason }, 'Message NACK processed');
        } else {
          logger.warn({ socketId: socket.id, userId, deviceId, messageId }, 'Message NACK failed - message not found');
        }
      } catch (err) {
        logger.error({ err, socketId: socket.id, userId, deviceId, messageId }, 'Error processing NACK');
      }
    });

    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Client disconnected');
    });
  });

  // Log connection errors emitted during handshake/middleware
  // This helps capture handshake failures before a 'connection' event
  io.on('connection_error', (err) => {
    logger.error({ err }, 'Socket connection_error - handshake or middleware failure');
  });

  // Log raw HTTP upgrade attempts so we can see the incoming WebSocket handshake
  try {
    httpServer.on('upgrade', (req, _socket, _head) => {
      try {
        logger.info(
          { url: req.url, method: req.method, headers: req.headers },
          'HTTP upgrade request (possible WebSocket handshake)'
        );
      } catch (e) {
        logger.info('HTTP upgrade request received');
      }
    });
  } catch (e) {
    // ignore if httpServer does not support 'upgrade'
  }

  return io;
}
