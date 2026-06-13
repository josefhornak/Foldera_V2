/**
 * Per-user rate limiters for authenticated, resource-intensive endpoints
 * (document upload, source creation, on-demand polls). These run AFTER
 * requireAuth, so they key on the authenticated user id — a single account
 * can't amplify OCR cost or flood the queues, independent of source IP.
 */
import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

const byUser = (req: Request): string => req.auth?.userId ?? req.ip ?? 'anon';

const make = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    keyGenerator: byUser,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Příliš mnoho požadavků, zkuste to prosím za chvíli.' },
  });

/** Document upload — generous for batch drag-and-drop, bounded for abuse. */
export const uploadLimiter = make(120);
/** Source create / connection test — these trigger outbound connections. */
export const sourceWriteLimiter = make(30);
/** On-demand poll — cheap but enqueues work. */
export const pollLimiter = make(60);
