import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { recordReceipt } from '../../services/receipts.service.js';
import logger from '../../utils/logger.js';

const router = Router();

// Apply authentication to all receipt routes
router.use(authenticate);

// Validation schema
const receiptSchema = z.object({
  messageId: z.string(),
  status: z.enum(['delivered', 'read']),
});

/**
 * POST /api/receipts
 * Record a delivery or read receipt
 */
router.post('/', validateBody(receiptSchema), async (req, res): Promise<void> => {
  try {
    // Extract userId and deviceId from JWT token
    const userId = (req as any).user?.userId;
    const deviceId = (req as any).user?.deviceId;

    if (!userId || !deviceId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { messageId, status } = req.body;

    await recordReceipt({
      messageId,
      deviceId,
      userId,
      status,
    });

    logger.info({ messageId, status }, 'Receipt recorded');

    res.status(201).json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Receipt recording error');
    res.status(500).json({ error: 'Failed to record receipt' });
  }
});

export default router;
