import { and, eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';

import { db } from '../db/client.js';
import { companies, companyMembers, type Company, type CompanyRole } from '../db/schema/index.js';
import { AppError, ErrorCodes } from '../utils/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    company?: Company;
    companyRole?: CompanyRole;
  }
}

/**
 * Resolves :companyId and verifies the authenticated user is a MEMBER of it
 * (any role). The user's role is attached as req.companyRole. Defense-in-depth:
 * every downstream query still scopes by companyId.
 */
export async function requireCompany(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const rawCompanyId = req.params.companyId;
    const companyId = Array.isArray(rawCompanyId) ? rawCompanyId[0] : rawCompanyId;
    if (!req.auth) throw new AppError(ErrorCodes.UNAUTHORIZED, 'Not authenticated', 401);
    if (!companyId) throw new AppError(ErrorCodes.BAD_REQUEST, 'Missing companyId', 400);

    const [row] = await db
      .select({ company: companies, role: companyMembers.role })
      .from(companyMembers)
      .innerJoin(companies, eq(companies.id, companyMembers.companyId))
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, req.auth.userId)))
      .limit(1);

    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, 'Company not found', 404);
    req.company = row.company;
    req.companyRole = row.role;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Like requireCompany, but additionally requires the 'admin' (správce) role.
 * Use on every mutating / configuration / billing / member-management route —
 * a plain member is read-only.
 */
export async function requireCompanyAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireCompany(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (req.companyRole !== 'admin') {
      return next(new AppError(ErrorCodes.FORBIDDEN, 'Tato akce vyžaduje roli správce.', 403));
    }
    next();
  });
}

/**
 * Role gate for routers that already ran requireCompany (so req.companyRole is
 * set) — avoids re-querying membership. A plain member is read-only.
 */
export function requireAdminRole(req: Request, _res: Response, next: NextFunction): void {
  if (req.companyRole !== 'admin') {
    next(new AppError(ErrorCodes.FORBIDDEN, 'Tato akce vyžaduje roli správce.', 403));
    return;
  }
  next();
}
