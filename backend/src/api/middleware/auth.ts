import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import logger from '../../utils/logger.js';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    deviceId: string;
    username: string;
  };
}

/**
 * JWT authentication middleware
 * Verifies the Bearer token and attaches user info to request
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = jwt.verify(token, config.jwtSecret) as {
      userId: string;
      deviceId: string;
      username: string;
    };

    // Attach user info to request
    (req as AuthRequest).user = {
      userId: decoded.userId,
      deviceId: decoded.deviceId,
      username: decoded.username,
    };

    next();
  } catch (err) {
    logger.error({ err }, 'Authentication failed');
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
