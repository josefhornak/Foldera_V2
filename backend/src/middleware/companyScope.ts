import { and, eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';

import { db } from '../db/client.js';
import { companies, type Company } from '../db/schema/index.js';
import { AppError, ErrorCodes } from '../utils/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    company?: Company;
  }
}

/**
 * Resolves :companyId and verifies the authenticated user owns it.
 * Defense-in-depth: every downstream query still scopes by companyId.
 */
export async function requireCompany(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const companyId = req.params.companyId;
    if (!req.auth) throw new AppError(ErrorCodes.UNAUTHORIZED, 'Not authenticated', 401);
    if (!companyId) throw new AppError(ErrorCodes.BAD_REQUEST, 'Missing companyId', 400);

    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.userId, req.auth.userId)))
      .limit(1);

    if (!company) throw new AppError(ErrorCodes.NOT_FOUND, 'Company not found', 404);
    req.company = company;
    next();
  } catch (err) {
    next(err);
  }
}
