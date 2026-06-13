import { randomBytes } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import env from '../config/env.js';
import { db } from '../db/client.js';
import { companies, companyInvitations, companyMembers, users } from '../db/schema/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCompany, requireCompanyAdmin } from '../middleware/companyScope.js';
import { testAbraConnection } from '../services/abraflexi/index.js';
import { getBillingSummary } from '../services/billing.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';
import { sendCompanyInvite } from '../utils/email.js';
import { AppError, ErrorCodes } from '../utils/errors.js';
import { generateId } from '../utils/ids.js';

const router = Router();
router.use(requireAuth);

const companySchema = z.object({
  name: z.string().min(1, 'Zadejte název firmy').max(200, 'Název firmy může mít nejvýše 200 znaků'),
  // Treat an empty/whitespace IČO as "not provided" so optional really is optional.
  ico: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().regex(/^\d{8}$/, 'IČO musí být přesně 8 číslic').nullish()
    ),
  /** Where this company's invoices are e-mailed (defaults to the account e-mail). */
  billingEmail: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().email('Zadejte platný e-mail').nullish()
    ),
  /** How accounting fields are filled when the supplier has no history. */
  accountingFillMode: z.enum(['history', 'ai']).optional(),
});

const abraConfigSchema = z.object({
  apiUrl: z.string().url(),
  apiUser: z.string().min(1),
  /** Omitted/empty = keep existing password */
  apiPassword: z.string().optional(),
});

/** Test body — all optional; missing fields fall back to the saved config. */
const abraTestSchema = z.object({
  apiUrl: z.string().url().optional(),
  apiUser: z.string().min(1).optional(),
  apiPassword: z.string().optional(),
});

function toPublicCompany(c: typeof companies.$inferSelect, role: 'admin' | 'member') {
  return {
    id: c.id,
    name: c.name,
    ico: c.ico,
    billingEmail: c.billingEmail,
    abraApiUrl: c.abraApiUrl,
    abraApiUser: c.abraApiUser,
    abraConfigured: Boolean(c.abraApiUrl && c.abraApiUser && c.abraApiPasswordEnc),
    accountingFillMode: c.accountingFillMode,
    trialEndsAt: c.trialEndsAt,
    createdAt: c.createdAt,
    /** The requesting user's role in this company. */
    role,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const rows = await db
      .select({ company: companies, role: companyMembers.role })
      .from(companyMembers)
      .innerJoin(companies, eq(companies.id, companyMembers.companyId))
      .where(eq(companyMembers.userId, req.auth!.userId))
      .orderBy(companies.createdAt);
    res.json({ companies: rows.map((r) => toPublicCompany(r.company, r.role)) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = companySchema.parse(req.body);
    const id = generateId('cmp');

    // The free trial is granted ONCE per user account, not per company —
    // otherwise a user could reset their trial by creating another company.
    // The first company a user ever creates gets the 7-day window; later
    // companies start already expired (must subscribe).
    const [owner] = await db
      .select({ trialStartedAt: users.trialStartedAt })
      .from(users)
      .where(eq(users.id, req.auth!.userId))
      .limit(1);
    const now = new Date();
    const firstTrial = !owner?.trialStartedAt;
    const trialEndsAt = firstTrial ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) : now;

    await db.insert(companies).values({
      id,
      userId: req.auth!.userId,
      name: body.name,
      ico: body.ico ?? null,
      // Invoices go to the chosen billing e-mail, defaulting to the account e-mail.
      billingEmail: body.billingEmail ?? req.auth!.email,
      trialEndsAt,
    });
    if (firstTrial) {
      await db.update(users).set({ trialStartedAt: now }).where(eq(users.id, req.auth!.userId));
    }
    // The creator is automatically the company's admin (správce).
    await db.insert(companyMembers).values({
      id: generateId('mem'),
      companyId: id,
      userId: req.auth!.userId,
      role: 'admin',
    });
    const [row] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    res.status(201).json({ company: toPublicCompany(row!, 'admin') });
  } catch (err) {
    next(err);
  }
});

router.patch('/:companyId', requireCompanyAdmin, async (req, res, next) => {
  try {
    const body = companySchema.partial().parse(req.body);
    await db
      .update(companies)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(companies.id, req.company!.id));
    const [row] = await db.select().from(companies).where(eq(companies.id, req.company!.id)).limit(1);
    res.json({ company: toPublicCompany(row!, req.companyRole!) });
  } catch (err) {
    next(err);
  }
});

/** Trial / subscription status + current-month usage. */
router.get('/:companyId/billing', requireCompany, async (req, res, next) => {
  try {
    const [c] = await db.select().from(companies).where(eq(companies.id, req.company!.id)).limit(1);
    if (!c) throw new AppError(ErrorCodes.NOT_FOUND, 'Company not found', 404);
    res.json({ billing: await getBillingSummary(c) });
  } catch (err) {
    next(err);
  }
});

/** Activate the paid subscription (billed monthly by invoice). */
router.post('/:companyId/subscribe', requireCompanyAdmin, async (req, res, next) => {
  try {
    const [existing] = await db
      .select({ startedAt: companies.subscriptionStartedAt })
      .from(companies)
      .where(eq(companies.id, req.company!.id))
      .limit(1);
    await db
      .update(companies)
      .set({
        billingStatus: 'active',
        // Preserve the original activation date across re-subscribes.
        subscriptionStartedAt: existing?.startedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, req.company!.id));
    const [c] = await db.select().from(companies).where(eq(companies.id, req.company!.id)).limit(1);
    res.json({ billing: await getBillingSummary(c!) });
  } catch (err) {
    next(err);
  }
});

/** Cancel the subscription (processing stops). */
router.post('/:companyId/cancel', requireCompanyAdmin, async (req, res, next) => {
  try {
    await db
      .update(companies)
      .set({ billingStatus: 'cancelled', updatedAt: new Date() })
      .where(eq(companies.id, req.company!.id));
    const [c] = await db.select().from(companies).where(eq(companies.id, req.company!.id)).limit(1);
    res.json({ billing: await getBillingSummary(c!) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:companyId', requireCompanyAdmin, async (req, res, next) => {
  try {
    await db.delete(companies).where(eq(companies.id, req.company!.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.put('/:companyId/abraflexi', requireCompanyAdmin, async (req, res, next) => {
  try {
    const body = abraConfigSchema.parse(req.body);
    const passwordEnc = body.apiPassword
      ? encryptSecret(body.apiPassword)
      : req.company!.abraApiPasswordEnc;
    if (!passwordEnc) {
      throw new AppError(ErrorCodes.BAD_REQUEST, 'API password is required', 400);
    }
    await db
      .update(companies)
      .set({
        abraApiUrl: body.apiUrl,
        abraApiUser: body.apiUser,
        abraApiPasswordEnc: passwordEnc,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, req.company!.id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:companyId/abraflexi/test', requireCompanyAdmin, async (req, res, next) => {
  try {
    const c = req.company!;
    const body = abraTestSchema.parse(req.body ?? {});

    // Test the values the user just entered; fall back to the saved config for
    // any field left blank (e.g. re-testing without re-typing the password).
    const apiUrl = body.apiUrl ?? c.abraApiUrl ?? undefined;
    const apiUser = body.apiUser ?? c.abraApiUser ?? undefined;
    const apiPassword =
      body.apiPassword && body.apiPassword.length > 0
        ? body.apiPassword
        : c.abraApiPasswordEnc
          ? decryptSecret(c.abraApiPasswordEnc)
          : undefined;

    if (!apiUrl || !apiUser || !apiPassword) {
      throw new AppError(
        ErrorCodes.BAD_REQUEST,
        'Vyplňte adresu API, uživatele a heslo připojení',
        400
      );
    }

    const result = await testAbraConnection({ apiUrl, apiUser, apiPassword, companyId: c.id });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Team (members + invitations)
// ───────────────────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email('Zadejte platný e-mail').toLowerCase(),
  role: z.enum(['admin', 'member']),
});

const roleSchema = z.object({ role: z.enum(['admin', 'member']) });

/** GET members + (admins only) pending invitations. Any member may view the team. */
router.get('/:companyId/members', requireCompany, async (req, res, next) => {
  try {
    const members = await db
      .select({ userId: companyMembers.userId, role: companyMembers.role, email: users.email, name: users.name })
      .from(companyMembers)
      .innerJoin(users, eq(users.id, companyMembers.userId))
      .where(eq(companyMembers.companyId, req.company!.id))
      .orderBy(companyMembers.createdAt);

    const isAdmin = req.companyRole === 'admin';
    const invitations = isAdmin
      ? await db
          .select({ id: companyInvitations.id, email: companyInvitations.email, role: companyInvitations.role })
          .from(companyInvitations)
          .where(and(eq(companyInvitations.companyId, req.company!.id), isNull(companyInvitations.acceptedAt)))
      : [];

    res.json({
      members: members.map((m) => ({ ...m, isYou: m.userId === req.auth!.userId })),
      invitations,
      role: req.companyRole,
    });
  } catch (err) {
    next(err);
  }
});

/** Invite a person by e-mail with a chosen role (správce only). */
router.post('/:companyId/invitations', requireCompanyAdmin, async (req, res, next) => {
  try {
    const body = inviteSchema.parse(req.body);

    // Already a member? (look up by e-mail)
    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (existingUser) {
      const [member] = await db
        .select({ id: companyMembers.id })
        .from(companyMembers)
        .where(and(eq(companyMembers.companyId, req.company!.id), eq(companyMembers.userId, existingUser.id)))
        .limit(1);
      if (member) throw new AppError(ErrorCodes.CONFLICT, 'Tento uživatel už ve firmě je.', 409);
    }

    // Refresh any existing pending invitation for this e-mail.
    await db
      .delete(companyInvitations)
      .where(and(eq(companyInvitations.companyId, req.company!.id), eq(companyInvitations.email, body.email)));

    const token = randomBytes(24).toString('base64url');
    await db.insert(companyInvitations).values({
      id: generateId('invt'),
      companyId: req.company!.id,
      email: body.email,
      role: body.role,
      token,
      invitedByUserId: req.auth!.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const link = `${env.APP_BASE_URL.replace(/\/$/, '')}/pozvanka/${token}`;
    await sendCompanyInvite(body.email, req.company!.name, body.role, link);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Revoke a pending invitation (správce only). */
router.delete('/:companyId/invitations/:invId', requireCompanyAdmin, async (req, res, next) => {
  try {
    await db
      .delete(companyInvitations)
      .where(and(eq(companyInvitations.id, String(req.params.invId)), eq(companyInvitations.companyId, req.company!.id)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** Change a member's role (správce only). Can't demote the last admin. */
router.patch('/:companyId/members/:userId', requireCompanyAdmin, async (req, res, next) => {
  try {
    const { role } = roleSchema.parse(req.body);
    if (role === 'member') await assertNotLastAdmin(req.company!.id, String(req.params.userId));
    await db
      .update(companyMembers)
      .set({ role })
      .where(and(eq(companyMembers.companyId, req.company!.id), eq(companyMembers.userId, String(req.params.userId))));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Remove a member (správce only). Can't remove the last admin. */
router.delete('/:companyId/members/:userId', requireCompanyAdmin, async (req, res, next) => {
  try {
    await assertNotLastAdmin(req.company!.id, String(req.params.userId));
    await db
      .delete(companyMembers)
      .where(and(eq(companyMembers.companyId, req.company!.id), eq(companyMembers.userId, String(req.params.userId))));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** Guard: a company must always keep at least one admin. */
async function assertNotLastAdmin(companyId: string, userId: string): Promise<void> {
  const admins = await db
    .select({ userId: companyMembers.userId })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.role, 'admin')));
  if (admins.length <= 1 && admins.some((a) => a.userId === userId)) {
    throw new AppError(ErrorCodes.CONFLICT, 'Firma musí mít alespoň jednoho správce.', 409);
  }
}

export default router;
