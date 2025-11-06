import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import logger from '../../utils/logger.js';

/**
 * Middleware factory to validate request body against a Zod schema
 */
export function validateBody(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        logger.warn({ errors: err.errors }, 'Validation error');
        res.status(400).json({
          error: 'Validation failed',
          details: err.errors,
        });
        return;
      }
      next(err);
    }
  };
}

/**
 * Middleware factory to validate query parameters against a Zod schema
 */
export function validateQuery(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      req.query = await schema.parseAsync(req.query);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        logger.warn({ errors: err.errors }, 'Query validation error');
        res.status(400).json({
          error: 'Validation failed',
          details: err.errors,
        });
        return;
      }
      next(err);
    }
  };
}

/**
 * Middleware factory to validate route parameters against a Zod schema
 */
export function validateParams(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      req.params = await schema.parseAsync(req.params);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        logger.warn({ errors: err.errors }, 'Params validation error');
        res.status(400).json({
          error: 'Validation failed',
          details: err.errors,
        });
        return;
      }
      next(err);
    }
  };
}
