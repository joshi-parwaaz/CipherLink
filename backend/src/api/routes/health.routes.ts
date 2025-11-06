import { Router, Request, Response } from 'express';
import logger from '../../utils/logger.js';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  logger.info('Health check requested');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
