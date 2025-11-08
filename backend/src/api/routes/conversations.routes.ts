import express, { Request, Response } from 'express';
import { z } from 'zod';
import { Conversation } from '../../models/Conversation.js';
import { Device } from '../../models/Device.js';
import { User } from '../../models/User.js';
import logger from '../../utils/logger.js';
import { authenticate } from '../middleware/auth.js';
import { io } from '../../realtime/socket.js';

const router = express.Router();

// Extend Express Request type to include user from auth middleware
interface AuthRequest extends Request {
  user?: {
    userId: string;
    deviceId: string;
    username: string;
  };
}

// Apply authentication to all conversation routes
router.use(authenticate);

// Create conversation schema
const createConversationSchema = z.object({
  convId: z.string().uuid(), // Client must generate UUID
  type: z.enum(['one_to_one', 'group']),
  memberUserIds: z.array(z.string()).min(2),
  groupName: z.string().max(100).optional(),
});

// POST /api/conversations - Create new conversation
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const validatedData = createConversationSchema.parse(req.body);

    // Check if conversation already exists with this convId
    const existing = await Conversation.findOne({ convId: validatedData.convId });
    if (existing) {
      res.status(409).json({ error: 'Conversation already exists' });
      return;
    }

    // For one_to_one conversations, check if a conversation already exists between these users
    if (validatedData.type === 'one_to_one') {
      const existingConversation = await Conversation.findOne({
        type: 'one_to_one',
        memberUserIds: { $all: validatedData.memberUserIds, $size: 2 },
        status: { $in: ['pending', 'accepted'] } // Don't allow new conversations if there's already an active one
      });

      if (existingConversation) {
        logger.warn(
          {
            existingConvId: existingConversation.convId,
            existingStatus: existingConversation.status,
            requestedConvId: validatedData.convId,
            memberUserIds: validatedData.memberUserIds,
          },
          'Attempted to create duplicate one-to-one conversation, returning existing'
        );
        res.status(200).json({
          convId: existingConversation.convId,
          type: existingConversation.type,
          memberUserIds: existingConversation.memberUserIds,
          memberDeviceIds: existingConversation.memberDeviceIds,
          groupName: existingConversation.groupName,
          status: existingConversation.status,
          createdAt: existingConversation.createdAt,
          message: 'Existing conversation returned'
        });
        return;
      }
    }

    // Validate one_to_one has exactly 2 members
    if (validatedData.type === 'one_to_one' && validatedData.memberUserIds.length !== 2) {
      res.status(400).json({ error: 'One-to-one conversations must have exactly 2 members' });
      return;
    }

    // Derive memberDeviceIds from active devices of member users
    const devices = await Device.find({
      userId: { $in: validatedData.memberUserIds },
      status: 'active',
    }).select('deviceId');

    const memberDeviceIds = devices.map((d) => d.deviceId);

    const conversation = new Conversation({
      convId: validatedData.convId,
      type: validatedData.type,
      memberUserIds: validatedData.memberUserIds,
      memberDeviceIds,
      status: 'pending', // Requires acceptance from recipient
      initiatorUserId: req.user!.userId, // Track who started the conversation
      groupName: validatedData.groupName,
      groupAdmins: validatedData.type === 'group' ? [req.user!.userId] : undefined,
    });

    await conversation.save();

    logger.info(
      {
        convId: conversation.convId,
        type: conversation.type,
        memberCount: conversation.memberUserIds.length,
        deviceCount: conversation.memberDeviceIds.length,
        status: conversation.status,
        initiator: req.user!.userId,
      },
      'Conversation request created'
    );

    // Notify other members via WebSocket
    const otherMembers = validatedData.memberUserIds.filter(id => id !== req.user!.userId);
    logger.info({ otherMembers, convId: conversation.convId }, 'Notifying other members of conversation request');
    otherMembers.forEach(userId => {
      logger.info({ userId, room: `user:${userId}`, convId: conversation.convId }, 'Emitting conversationRequest to room');
      const room = io.sockets.adapter.rooms.get(`user:${userId}`);
      logger.info({ userId, roomExists: !!room, roomSize: room ? room.size : 0 }, 'Room status before emit');
      io.to(`user:${userId}`).emit('conversationRequest', {
        convId: conversation.convId,
        type: conversation.type,
        initiatorUserId: req.user!.userId,
        initiatorUsername: req.user!.username,
        groupName: conversation.groupName,
        createdAt: conversation.createdAt,
      });
      logger.info({ userId, convId: conversation.convId }, 'ConversationRequest emitted');
    });

    res.status(201).json({
      convId: conversation.convId,
      type: conversation.type,
      memberUserIds: conversation.memberUserIds,
      memberDeviceIds: conversation.memberDeviceIds,
      groupName: conversation.groupName,
      status: conversation.status,
      createdAt: conversation.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
      return;
    }
    logger.error(error, 'Failed to create conversation');
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// GET /api/conversations/:convId - Get conversation details
router.get('/:convId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { convId } = req.params;

    const conversation = await Conversation.findOne({ convId });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Check if user is a member
    if (!conversation.memberUserIds.includes(req.user!.userId)) {
      res.status(403).json({ error: 'Not a member of this conversation' });
      return;
    }

    res.json({
      convId: conversation.convId,
      type: conversation.type,
      memberUserIds: conversation.memberUserIds,
      memberDeviceIds: conversation.memberDeviceIds,
      groupName: conversation.groupName,
      lastMessageAt: conversation.lastMessageAt,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    });
  } catch (error) {
    logger.error(error, 'Failed to get conversation');
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

// GET /api/conversations - List user's conversations
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Get all conversations for the user
    const allConversations = await Conversation.find({
      memberUserIds: req.user!.userId,
    })
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .limit(200); // Get more to allow for deduplication

    // Deduplicate one-to-one conversations - only keep the most recent active conversation per user pair
    const conversationMap = new Map<string, any>();
    const processedPairs = new Set<string>();

    for (const conv of allConversations) {
      if (conv.type === 'one_to_one') {
        // Create a unique key for the user pair (sorted to ensure consistency)
        const userPair = conv.memberUserIds.sort().join('-');

        // Skip if we've already processed this user pair
        if (processedPairs.has(userPair)) {
          logger.info({
            convId: conv.convId,
            userPair,
            status: conv.status,
            createdAt: conv.createdAt
          }, 'Skipping duplicate one-to-one conversation');
          continue;
        }

        // Mark this pair as processed
        processedPairs.add(userPair);
      }

      // Add conversation to result map
      conversationMap.set(conv.convId, conv);
    }

    // Convert map to array and sort by lastMessageAt
    const conversations = Array.from(conversationMap.values())
      .sort((a, b) => {
        // Sort by lastMessageAt (most recent first), then by createdAt
        if (a.lastMessageAt && b.lastMessageAt) {
          return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
        }
        if (a.lastMessageAt && !b.lastMessageAt) return -1;
        if (!a.lastMessageAt && b.lastMessageAt) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, 100); // Limit to 100 conversations

    logger.info({
      totalFound: allConversations.length,
      afterDeduplication: conversations.length,
      userId: req.user!.userId
    }, 'Conversation list deduplicated');

    res.json({
      conversations: conversations.map((c) => {
        return {
          convId: c.convId,
          type: c.type,
          memberUserIds: c.memberUserIds,
          groupName: c.groupName,
          status: c.status, // Include status so frontend knows if pending/accepted
          initiatorUserId: c.initiatorUserId, // Include initiator to distinguish sent vs received requests
          lastMessageAt: c.lastMessageAt,
          createdAt: c.createdAt,
        };
      }),
    });
  } catch (error) {
    logger.error(error, 'Failed to list conversations');
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

// GET /api/conversations/pending - List pending conversation requests for current user
router.get('/requests/pending', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    logger.info({ userId }, 'Fetching pending conversation requests');

    // Find conversations where user is a member but status is 'pending' and user is NOT the initiator
    const pendingRequests = await Conversation.find({
      memberUserIds: userId,
      status: 'pending',
      initiatorUserId: { $ne: userId }, // Not initiated by current user
    })
      .sort({ createdAt: -1 })
      .limit(50);

    logger.info({ userId, count: pendingRequests.length }, 'Found pending requests in database');

    // Fetch initiator usernames
    const conversationsWithInitiator = await Promise.all(
      pendingRequests.map(async (conv) => {
        const initiatorUser = await User.findById(conv.initiatorUserId).select('username');
        const result = {
          convId: conv.convId,
          type: conv.type,
          initiatorUserId: conv.initiatorUserId,
          initiatorUsername: initiatorUser?.username || 'Unknown',
          groupName: conv.groupName,
          createdAt: conv.createdAt,
        };
        logger.info({ userId, convId: conv.convId, initiatorUsername: result.initiatorUsername }, 'Pending request details');
        return result;
      })
    );

    logger.info({ userId, finalCount: conversationsWithInitiator.length }, 'Returning pending requests');

    res.json({
      pending: conversationsWithInitiator,
    });
  } catch (error) {
    logger.error(error, 'Failed to list pending requests');
    res.status(500).json({ error: 'Failed to list pending requests' });
  }
});

// PUT /api/conversations/:convId/devices - Refresh device list (called when devices change)
router.put('/:convId/devices', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { convId } = req.params;

    const conversation = await Conversation.findOne({ convId });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Check if user is a member
    if (!conversation.memberUserIds.includes(req.user!.userId)) {
      res.status(403).json({ error: 'Not a member of this conversation' });
      return;
    }

    // Re-derive memberDeviceIds from current active devices
    const devices = await Device.find({
      userId: { $in: conversation.memberUserIds },
      status: 'active',
    }).select('deviceId');

    conversation.memberDeviceIds = devices.map((d) => d.deviceId);
    await conversation.save();

    logger.info(
      {
        convId: conversation.convId,
        deviceCount: conversation.memberDeviceIds.length,
      },
      'Conversation devices refreshed'
    );

    res.json({
      memberDeviceIds: conversation.memberDeviceIds,
    });
  } catch (error) {
    logger.error(error, 'Failed to refresh conversation devices');
    res.status(500).json({ error: 'Failed to refresh devices' });
  }
});

// POST /api/conversations/:convId/accept - Accept conversation request
router.post('/:convId/accept', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { convId } = req.params;

    const conversation = await Conversation.findOne({ convId });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Check if user is a member
    if (!conversation.memberUserIds.includes(req.user!.userId)) {
      res.status(403).json({ error: 'Not a member of this conversation' });
      return;
    }

    // Check if user is NOT the initiator (can't accept your own request)
    if (conversation.initiatorUserId === req.user!.userId) {
      res.status(400).json({ error: 'Cannot accept your own conversation request' });
      return;
    }

    // Check if already accepted
    if (conversation.status === 'accepted') {
      res.status(400).json({ error: 'Conversation already accepted' });
      return;
    }

    // Check if rejected
    if (conversation.status === 'rejected') {
      res.status(400).json({ error: 'Conversation was rejected' });
      return;
    }

    // Accept the conversation
    conversation.status = 'accepted';
    
    // Refresh memberDeviceIds to include all current active devices
    const devices = await Device.find({
      userId: { $in: conversation.memberUserIds },
      status: 'active',
    }).select('deviceId');
    
    conversation.memberDeviceIds = devices.map((d) => d.deviceId);
    
    await conversation.save();

    logger.info(
      {
        convId: conversation.convId,
        acceptedBy: req.user!.userId,
        initiator: conversation.initiatorUserId,
        memberDeviceIds: conversation.memberDeviceIds,
      },
      'Conversation request accepted'
    );

    // Notify initiator via WebSocket
    io.to(`user:${conversation.initiatorUserId}`).emit('conversationAccepted', {
      convId: conversation.convId,
      acceptedBy: req.user!.userId,
      acceptedByUsername: req.user!.username,
    });

    res.json({
      convId: conversation.convId,
      status: conversation.status,
      message: 'Conversation accepted',
    });
  } catch (error) {
    logger.error(error, 'Failed to accept conversation');
    res.status(500).json({ error: 'Failed to accept conversation' });
  }
});

// POST /api/conversations/:convId/reject - Reject conversation request
router.post('/:convId/reject', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { convId } = req.params;

    const conversation = await Conversation.findOne({ convId });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Check if user is a member
    if (!conversation.memberUserIds.includes(req.user!.userId)) {
      res.status(403).json({ error: 'Not a member of this conversation' });
      return;
    }

    // Check if user is NOT the initiator (can't reject your own request)
    if (conversation.initiatorUserId === req.user!.userId) {
      res.status(400).json({ error: 'Cannot reject your own conversation request' });
      return;
    }

    // Reject the conversation
    conversation.status = 'rejected';
    await conversation.save();

    logger.info(
      {
        convId: conversation.convId,
        rejectedBy: req.user!.userId,
        initiator: conversation.initiatorUserId,
      },
      'Conversation request rejected'
    );

    res.json({
      convId: conversation.convId,
      status: conversation.status,
      message: 'Conversation rejected',
    });
  } catch (error) {
    logger.error(error, 'Failed to reject conversation');
    res.status(500).json({ error: 'Failed to reject conversation' });
  }
});

// DELETE /api/conversations - Clear all conversations for current user (for testing/debugging)
router.delete('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Only allow in development mode for safety
    if (process.env.NODE_ENV !== 'development') {
      res.status(403).json({ error: 'This endpoint is only available in development mode' });
      return;
    }

    const result = await Conversation.deleteMany({
      memberUserIds: req.user!.userId,
    });

    logger.warn(
      {
        userId: req.user!.userId,
        deletedCount: result.deletedCount,
      },
      'All conversations cleared for user (development only)'
    );

    res.json({
      message: `Cleared ${result.deletedCount} conversations`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    logger.error(error, 'Failed to clear conversations');
    res.status(500).json({ error: 'Failed to clear conversations' });
  }
});

export default router;
