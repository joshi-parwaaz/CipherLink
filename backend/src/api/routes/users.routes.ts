import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { User } from '../../models/User.js';
import { validateQuery } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import logger from '../../utils/logger.js';

const router = Router();

// Apply authentication to all user routes
router.use(authenticate);

// Validation schemas
const searchUsersSchema = z.object({
  q: z.string().min(1).max(100), // Search query
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
});

/**
 * GET /api/users/search
 * Search for users by username (public endpoint, no auth required initially)
 */
router.get('/search', validateQuery(searchUsersSchema), async (req, res): Promise<void> => {
  try {
    const { q, limit } = req.query as unknown as { q: string; limit: number };

    const users = await User.find({
      username: { $regex: q, $options: 'i' },
    })
      .select('username displayName identityPublicKey')
      .limit(limit || 20);

    logger.info({ query: q, resultsCount: users.length }, 'Users searched');

    res.json({
      users: users.map((u) => ({
        id: (u._id as Types.ObjectId).toString(), // Convert ObjectId to string to match Device.userId format
        username: u.username,
        displayName: u.displayName,
        identityPublicKey: u.identityPublicKey,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'User search error');
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/users/id/:userId
 * Get user profile by user ID
 */
router.get('/id/:userId', async (req, res): Promise<void> => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select(
      'username displayName identityPublicKey createdAt'
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: (user._id as Types.ObjectId).toString(),
      username: user.username,
      displayName: user.displayName,
      identityPublicKey: user.identityPublicKey,
      createdAt: user.createdAt,
    });
  } catch (err) {
    logger.error({ err }, 'Get user by ID error');
    res.status(500).json({ error: 'Failed to retrieve user' });
  }
});

/**
 * GET /api/users/:username
 * Get user profile by username
 */
router.get('/:username', async (req, res): Promise<void> => {
  try {
    const { username } = req.params;

    const user = await User.findOne({ username }).select(
      'username displayName identityPublicKey createdAt'
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: (user._id as Types.ObjectId).toString(), // Convert ObjectId to string to match Device.userId format
      username: user.username,
      displayName: user.displayName,
      identityPublicKey: user.identityPublicKey,
      createdAt: user.createdAt,
    });
  } catch (err) {
    logger.error({ err }, 'Get user error');
    res.status(500).json({ error: 'Failed to retrieve user' });
  }
});

export default router;
