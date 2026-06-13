/**
 * Operator (admin) authorization. The Foldera operator issues subscription
 * invoices to customer companies and needs a cross-tenant overview to track
 * payments. Admin accounts are configured by e-mail in ADMIN_EMAILS.
 */
import type { NextFunction, Request, Response } from 'express';

import env from '../config/env.js';
import { AppError, ErrorCodes } from '../utils/errors.js';

const ADMIN_EMAILS = new Set(
  env.ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.toLowerCase());
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!isAdminEmail(req.auth?.email)) {
    next(new AppError(ErrorCodes.FORBIDDEN, 'Forbidden', 403));
    return;
  }
  next();
}
