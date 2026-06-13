/**
 * Company invitation acceptance. Public GET to preview the invite (drives the
 * /pozvanka/:token page); authenticated POST to accept it. The accepting user's
 * e-mail must match the invited address so a forwarded link can't be misused.
 */
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';

import { db } from '../db/client.js';
import { companies, companyInvitations, companyMembers, users } from '../db/schema/index.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, ErrorCodes } from '../utils/errors.js';
import { generateId } from '../utils/ids.js';

const router = Router();

async function loadInvite(token: string) {
  const [inv] = await db
    .select({
      id: companyInvitations.id,
      companyId: companyInvitations.companyId,
      email: companyInvitations.email,
      role: companyInvitations.role,
      expiresAt: companyInvitations.expiresAt,
      acceptedAt: companyInvitations.acceptedAt,
      companyName: companies.name,
    })
    .from(companyInvitations)
    .innerJoin(companies, eq(companies.id, companyInvitations.companyId))
    .where(eq(companyInvitations.token, token))
    .limit(1);
  return inv;
}

/** Public preview — what company / role the invite is for. */
router.get('/:token', async (req, res, next) => {
  try {
    const inv = await loadInvite(String(req.params.token));
    if (!inv || inv.acceptedAt || inv.expiresAt.getTime() < Date.now()) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Pozvánka je neplatná nebo už vypršela.', 404);
    }
    res.json({ invitation: { companyName: inv.companyName, role: inv.role, email: inv.email } });
  } catch (err) {
    next(err);
  }
});

/** Accept — joins the logged-in user to the company (e-mail must match). */
router.post('/:token/accept', requireAuth, async (req, res, next) => {
  try {
    const inv = await loadInvite(String(req.params.token));
    if (!inv || inv.acceptedAt || inv.expiresAt.getTime() < Date.now()) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Pozvánka je neplatná nebo už vypršela.', 404);
    }

    const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, req.auth!.userId)).limit(1);
    if (!me || me.email.toLowerCase() !== inv.email.toLowerCase()) {
      throw new AppError(
        ErrorCodes.FORBIDDEN,
        `Pozvánka byla zaslána na ${inv.email}. Přihlaste se prosím tímto e-mailem.`,
        403
      );
    }

    const [existing] = await db
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, inv.companyId), eq(companyMembers.userId, req.auth!.userId)))
      .limit(1);
    if (!existing) {
      await db.insert(companyMembers).values({
        id: generateId('mem'),
        companyId: inv.companyId,
        userId: req.auth!.userId,
        role: inv.role,
      });
    }
    await db.update(companyInvitations).set({ acceptedAt: new Date() }).where(eq(companyInvitations.id, inv.id));

    res.json({ ok: true, companyId: inv.companyId });
  } catch (err) {
    next(err);
  }
});

export default router;
