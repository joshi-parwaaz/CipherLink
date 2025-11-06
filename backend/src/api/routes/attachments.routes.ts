import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { uploadAttachment, downloadAttachment } from '../../services/attachments.service.js';
import logger from '../../utils/logger.js';

const router = Router();

// Apply authentication to all attachment routes
router.use(authenticate);

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

/**
 * POST /api/attachments/upload
 * Upload an encrypted attachment
 */
router.post('/upload', upload.single('file'), async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const deviceId = (req as any).user?.deviceId;

    if (!userId || !deviceId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const { messageId, metadata } = req.body;

    if (!messageId || !metadata) {
      res.status(400).json({ error: 'Missing messageId or metadata' });
      return;
    }

    const result = await uploadAttachment(
      messageId,
      userId,
      deviceId,
      req.file.buffer,
      metadata
    );

    logger.info({ attachmentId: result.attachmentId }, 'Attachment uploaded');

    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, 'Attachment upload error');
    res.status(500).json({ error: 'Failed to upload attachment' });
  }
});

/**
 * GET /api/attachments/:attachmentId
 * Download an encrypted attachment
 */
router.get('/:attachmentId', async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { attachmentId } = req.params;

    const { stream, metadata, sizeBytes } = await downloadAttachment(attachmentId);

    // Set headers
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', sizeBytes);
    res.setHeader('X-Encrypted-Metadata', metadata);

    // Stream the file
    stream.pipe(res);
  } catch (err) {
    logger.error({ err }, 'Attachment download error');
    res.status(500).json({ error: 'Failed to download attachment' });
  }
});

export default router;
