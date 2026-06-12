import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';

import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    // Surface the first issue's (human-readable) message and the field it
    // belongs to, so the client can show something better than "Bad Request".
    const first = err.issues[0];
    const field = first?.path.join('.') || undefined;
    const message = first?.message || 'Neplatný požadavek';
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message, field, details: err.issues },
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
}
