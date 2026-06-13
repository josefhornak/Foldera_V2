import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db/client.js';
import { companies } from '../db/schema/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCompany } from '../middleware/companyScope.js';
import { testAbraConnection } from '../services/abraflexi/index.js';
import { getBillingSummary } from '../services/billing.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';
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

function toPublicCompany(c: typeof companies.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    ico: c.ico,
    abraApiUrl: c.abraApiUrl,
    abraApiUser: c.abraApiUser,
    abraConfigured: Boolean(c.abraApiUrl && c.abraApiUser && c.abraApiPasswordEnc),
    accountingFillMode: c.accountingFillMode,
    trialEndsAt: c.trialEndsAt,
    createdAt: c.createdAt,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.select().from(companies).where(eq(companies.userId, req.auth!.userId));
    res.json({ companies: rows.map(toPublicCompany) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = companySchema.parse(req.body);
    const id = generateId('cmp');
    // Start the 7-day free trial on company creation.
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.insert(companies).values({
      id,
      userId: req.auth!.userId,
      name: body.name,
      ico: body.ico ?? null,
      trialEndsAt,
    });
    const [row] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    res.status(201).json({ company: toPublicCompany(row!) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:companyId', requireCompany, async (req, res, next) => {
  try {
    const body = companySchema.partial().parse(req.body);
    await db
      .update(companies)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(companies.id, req.company!.id), eq(companies.userId, req.auth!.userId)));
    const [row] = await db.select().from(companies).where(eq(companies.id, req.company!.id)).limit(1);
    res.json({ company: toPublicCompany(row!) });
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
router.post('/:companyId/subscribe', requireCompany, async (req, res, next) => {
  try {
    await db
      .update(companies)
      .set({ billingStatus: 'active', updatedAt: new Date() })
      .where(and(eq(companies.id, req.company!.id), eq(companies.userId, req.auth!.userId)));
    const [c] = await db.select().from(companies).where(eq(companies.id, req.company!.id)).limit(1);
    res.json({ billing: await getBillingSummary(c!) });
  } catch (err) {
    next(err);
  }
});

/** Cancel the subscription (processing stops). */
router.post('/:companyId/cancel', requireCompany, async (req, res, next) => {
  try {
    await db
      .update(companies)
      .set({ billingStatus: 'cancelled', updatedAt: new Date() })
      .where(and(eq(companies.id, req.company!.id), eq(companies.userId, req.auth!.userId)));
    const [c] = await db.select().from(companies).where(eq(companies.id, req.company!.id)).limit(1);
    res.json({ billing: await getBillingSummary(c!) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:companyId', requireCompany, async (req, res, next) => {
  try {
    await db
      .delete(companies)
      .where(and(eq(companies.id, req.company!.id), eq(companies.userId, req.auth!.userId)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.put('/:companyId/abraflexi', requireCompany, async (req, res, next) => {
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
      .where(and(eq(companies.id, req.company!.id), eq(companies.userId, req.auth!.userId)));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:companyId/abraflexi/test', requireCompany, async (req, res, next) => {
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

export default router;
