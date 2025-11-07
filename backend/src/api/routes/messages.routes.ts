import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { 
  deliverMessage, 
  getPendingMessages,
  markMessageDelivered,
  markMessageFailed 
} from '../../services/delivery.service.js';
import { Conversation } from '../../models/Conversation.js';
import { Message } from '../../models/Message.js';
import logger from '../../utils/logger.js';

const router = Router();

// Apply authentication to all message routes
router.use(authenticate);

// Validation schemas per spec
const sendMessageSchema = z.object({
  messageId: z.string(), // UUID/nanoid
  convId: z.string(), // References Conversation.convId
  toDeviceIds: z.array(z.string()).min(1),
  aad: z.object({
    senderId: z.string(),
    recipientIds: z.array(z.string()),
    ts: z.string().transform((val) => new Date(val)),
  }),
  nonce: z.string(),
  ciphertext: z.string(),
  attachmentIds: z.array(z.string()).optional(),
  sentAt: z.string().transform((val) => new Date(val)),
  ttl: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
  messageNumber: z.number().optional(), // 2key-ratchet message counter
});

/**
 * POST /api/messages
 * Send an encrypted message
 */
router.post('/', validateBody(sendMessageSchema), async (req, res): Promise<void> => {
  try {
    // Extract userId and deviceId from JWT token (set by auth middleware)
    const userId = (req as any).user?.userId;
    const deviceId = (req as any).user?.deviceId;

    if (!userId || !deviceId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      messageId,
      convId,
      toDeviceIds,
      aad,
      nonce,
      ciphertext,
      attachmentIds,
      sentAt,
      ttl,
      messageNumber,
    } = req.body;

    // Validate conversation exists
    const conversation = await Conversation.findOne({ convId });
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Check if conversation is accepted
    if (conversation.status !== 'accepted') {
      res.status(403).json({ 
        error: 'Conversation not accepted', 
        details: `Conversation status is ${conversation.status}. Only accepted conversations can send messages.`
      });
      return;
    }

    // Validate user is a member of the conversation
    if (!conversation.memberUserIds.includes(userId)) {
      res.status(403).json({ error: 'Not a member of this conversation' });
      return;
    }

    // Validate toDeviceIds are subset of conversation's memberDeviceIds (per spec)
    const invalidDevices = toDeviceIds.filter(
      (deviceId: string) => !conversation.memberDeviceIds.includes(deviceId)
    );
    if (invalidDevices.length > 0) {
      res.status(400).json({
        error: 'Invalid recipient devices',
        details: 'toDeviceIds must be subset of active devices for conversation members',
        invalidDevices,
      });
      return;
    }

    // Deliver the message
    const message = await deliverMessage({
      messageId,
      convId,
      fromUserId: userId,
      fromDeviceId: deviceId,
      toDeviceIds,
      aad,
      nonce,
      ciphertext,
      attachmentIds,
      sentAt,
      ttl,
      messageNumber,
    });

    // Update conversation's lastMessageAt
    conversation.lastMessageAt = message.serverReceivedAt;
    await conversation.save();

    logger.info(
      {
        messageId: message.messageId,
        convId: message.convId,
        toDeviceCount: message.toDeviceIds.length,
      },
      'Message delivered'
    );

    res.status(201).json({
      messageId: message.messageId,
      serverReceivedAt: message.serverReceivedAt,
    });
  } catch (err) {
    logger.error({ err }, 'Send message error');
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * GET /api/messages/pending/:deviceId
 * Get pending messages for a device
 */
router.get('/pending/:deviceId', async (req, res): Promise<void> => {
  try {
    const { deviceId } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;

    // Verify device belongs to authenticated user
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const messages = await getPendingMessages(deviceId, limit);

    res.json({
      messages: messages.map((m) => ({
        messageId: m.messageId,
        convId: m.convId,
        fromUserId: m.fromUserId,
        fromDeviceId: m.fromDeviceId,
        toDeviceIds: m.toDeviceIds,
        aad: m.aad,
        nonce: m.nonce,
        ciphertext: m.ciphertext,
        attachmentIds: m.attachmentIds,
        sentAt: m.sentAt,
        serverReceivedAt: m.serverReceivedAt,
        ttl: m.ttl,
        messageNumber: m.messageNumber,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Get pending messages error');
    res.status(500).json({ error: 'Failed to retrieve messages' });
  }
});

/**
 * GET /api/messages/conversation/:convId
 * Get message history for a conversation (encrypted)
 * Returns all messages regardless of status for persistent history
 */
router.get('/conversation/:convId', async (req, res): Promise<void> => {
  try {
    const { convId } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const userId = (req as any).user?.userId;
    const deviceId = (req as any).user?.deviceId;

    if (!userId || !deviceId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Verify user is member of conversation
    const conversation = await Conversation.findOne({ convId });
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    if (!conversation.memberUserIds.includes(userId)) {
      res.status(403).json({ error: 'Not a member of this conversation' });
      return;
    }

    // Fetch messages for this conversation
    // Include messages TO this device or FROM this device
    const messages = await Message.find({
      convId,
      $or: [
        { toDeviceIds: deviceId },
        { fromDeviceId: deviceId }
      ]
    })
      .sort({ serverReceivedAt: 1 })
      .skip(offset)
      .limit(limit);

    res.json({
      messages: messages.map((m) => ({
        messageId: m.messageId,
        convId: m.convId,
        fromUserId: m.fromUserId,
        fromDeviceId: m.fromDeviceId,
        ciphertext: m.ciphertext,
        nonce: m.nonce,
        aad: m.aad,
        messageNumber: m.messageNumber,
        sentAt: m.sentAt,
        serverReceivedAt: m.serverReceivedAt,
        status: m.status
      })),
      total: messages.length,
      hasMore: messages.length === limit
    });

    logger.info(
      { convId, userId, count: messages.length },
      'Conversation history fetched'
    );
  } catch (err) {
    logger.error({ err }, 'Get conversation messages error');
    res.status(500).json({ error: 'Failed to retrieve messages' });
  }
});

/**
 * POST /api/messages/ack
 * Acknowledge successful message receipt and decryption
 */
router.post('/ack', validateBody(z.object({
  messageId: z.string(),
})), async (req, res): Promise<void> => {
  try {
    const { messageId } = req.body;
    const deviceId = (req as any).user?.deviceId;

    if (!deviceId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const success = await markMessageDelivered(messageId, deviceId);

    if (success) {
      res.status(200).json({ success: true });
    } else {
      res.status(404).json({ error: 'Message not found or already acknowledged' });
    }
  } catch (err) {
    logger.error({ err }, 'ACK message error');
    res.status(500).json({ error: 'Failed to acknowledge message' });
  }
});

/**
 * POST /api/messages/nack
 * Report message decryption failure (prevents infinite retry)
 */
router.post('/nack', validateBody(z.object({
  messageId: z.string(),
  reason: z.string().optional(),
})), async (req, res): Promise<void> => {
  try {
    const { messageId, reason } = req.body;
    const deviceId = (req as any).user?.deviceId;

    if (!deviceId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const success = await markMessageFailed(messageId, deviceId, reason);

    if (success) {
      res.status(200).json({ success: true });
    } else {
      res.status(404).json({ error: 'Message not found' });
    }
  } catch (err) {
    logger.error({ err }, 'NACK message error');
    res.status(500).json({ error: 'Failed to report message failure' });
  }
});

export default router;
