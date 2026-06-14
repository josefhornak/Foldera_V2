/**
 * Operator-only invoices overview: list every issued subscription invoice and
 * mark payments. Cross-tenant by design (the operator bills all customers) and
 * gated by requireAdmin.
 */
import { count, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';

import { db } from '../db/client.js';
import { companies, companyMembers, documents, invoices, sources, users } from '../db/schema/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { PLAN_PRICE_CZK } from '../services/billing.js';
import { AppError, ErrorCodes } from '../utils/errors.js';

const num = (v: unknown): number => Number(v ?? 0);

const router = Router();
router.use(requireAuth, requireAdmin);

type InvoiceState = 'paid' | 'overdue' | 'sent' | 'failed';

/** GET /invoices — all issued invoices with a derived payment state + summary. */
router.get('/invoices', async (_req, res, next) => {
  try {
    const rows = await db.select().from(invoices).orderBy(desc(invoices.createdAt));
    const today = new Date().toISOString().slice(0, 10);
    const list = rows.map((r) => {
      const state: InvoiceState =
        r.status === 'failed' ? 'failed' : r.paidAt ? 'paid' : r.dueDate < today ? 'overdue' : 'sent';
      return {
        id: r.id,
        number: r.number,
        period: r.period,
        customerName: r.customerName,
        customerIco: r.customerIco,
        recipientEmail: r.recipientEmail,
        issueDate: r.issueDate,
        dueDate: r.dueDate,
        variableSymbol: r.variableSymbol,
        totalCzk: r.totalCzk,
        paidAt: r.paidAt ? r.paidAt.toISOString() : null,
        state,
      };
    });
    const summary = {
      total: list.length,
      paid: list.filter((i) => i.state === 'paid').length,
      overdue: list.filter((i) => i.state === 'overdue').length,
      outstandingCzk: list
        .filter((i) => i.state === 'sent' || i.state === 'overdue')
        .reduce((s, i) => s + i.totalCzk, 0),
    };
    res.json({ invoices: list, summary });
  } catch (err) {
    next(err);
  }
});

/** POST /invoices/:id/paid — mark an invoice paid (now). */
router.post('/invoices/:id/paid', async (req, res, next) => {
  try {
    const [row] = await db
      .update(invoices)
      .set({ paidAt: new Date() })
      .where(eq(invoices.id, req.params.id!))
      .returning({ id: invoices.id });
    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, 'Invoice not found', 404);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** POST /invoices/:id/unpaid — revert the paid mark. */
router.post('/invoices/:id/unpaid', async (req, res, next) => {
  try {
    const [row] = await db
      .update(invoices)
      .set({ paidAt: null })
      .where(eq(invoices.id, req.params.id!))
      .returning({ id: invoices.id });
    if (!row) throw new AppError(ErrorCodes.NOT_FOUND, 'Invoice not found', 404);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET /overview — cross-tenant totals for the admin dashboard. */
router.get('/overview', async (_req, res, next) => {
  try {
    const [[u], [c], [d], byStatus, [inv]] = await Promise.all([
      db.select({ n: count() }).from(users),
      db.select({ n: count() }).from(companies),
      db
        .select({ total: count(), exported: sql<number>`count(*) filter (where ${documents.status} = 'exported')` })
        .from(documents),
      db.select({ status: companies.billingStatus, n: count() }).from(companies).groupBy(companies.billingStatus),
      db
        .select({
          n: count(),
          outstanding: sql<number>`coalesce(sum(${invoices.totalCzk}) filter (where ${invoices.paidAt} is null and ${invoices.status} <> 'failed'), 0)`,
        })
        .from(invoices),
    ]);
    const status = (s: string) => num(byStatus.find((b) => b.status === s)?.n);
    res.json({
      overview: {
        users: num(u?.n),
        companies: num(c?.n),
        docsTotal: num(d?.total),
        docsExported: num(d?.exported),
        trial: status('trial'),
        active: status('active'),
        cancelled: status('cancelled'),
        mrrCzk: status('active') * PLAN_PRICE_CZK,
        invoicesOutstandingCzk: num(inv?.outstanding),
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /companies — every company with owner + usage stats. */
router.get('/companies', async (_req, res, next) => {
  try {
    const [list, docs, mem, src] = await Promise.all([
      db
        .select({
          id: companies.id,
          name: companies.name,
          ico: companies.ico,
          billingStatus: companies.billingStatus,
          trialEndsAt: companies.trialEndsAt,
          subscriptionStartedAt: companies.subscriptionStartedAt,
          createdAt: companies.createdAt,
          abraConfigured: sql<boolean>`(${companies.abraApiUrl} is not null and ${companies.abraApiPasswordEnc} is not null)`,
          ownerEmail: users.email,
        })
        .from(companies)
        .leftJoin(users, eq(users.id, companies.userId))
        .orderBy(desc(companies.createdAt)),
      db
        .select({
          companyId: documents.companyId,
          total: count(),
          exported: sql<number>`count(*) filter (where ${documents.status} = 'exported')`,
        })
        .from(documents)
        .groupBy(documents.companyId),
      db.select({ companyId: companyMembers.companyId, n: count() }).from(companyMembers).groupBy(companyMembers.companyId),
      db.select({ companyId: sources.companyId, n: count() }).from(sources).groupBy(sources.companyId),
    ]);
    const docMap = new Map(docs.map((x) => [x.companyId, x]));
    const memMap = new Map(mem.map((x) => [x.companyId, num(x.n)]));
    const srcMap = new Map(src.map((x) => [x.companyId, num(x.n)]));
    res.json({
      companies: list.map((c) => ({
        id: c.id,
        name: c.name,
        ico: c.ico,
        ownerEmail: c.ownerEmail,
        billingStatus: c.billingStatus,
        abraConfigured: c.abraConfigured,
        createdAt: c.createdAt.toISOString(),
        trialEndsAt: c.trialEndsAt ? c.trialEndsAt.toISOString() : null,
        subscriptionStartedAt: c.subscriptionStartedAt ? c.subscriptionStartedAt.toISOString() : null,
        docsTotal: num(docMap.get(c.id)?.total),
        docsExported: num(docMap.get(c.id)?.exported),
        members: memMap.get(c.id) ?? 0,
        sources: srcMap.get(c.id) ?? 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /users — every account with its company count. */
router.get('/users', async (_req, res, next) => {
  try {
    const [list, owned] = await Promise.all([
      db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          emailVerified: users.emailVerified,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt)),
      db.select({ userId: companies.userId, n: count() }).from(companies).groupBy(companies.userId),
    ]);
    const ownedMap = new Map(owned.map((x) => [x.userId, num(x.n)]));
    res.json({
      users: list.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        emailVerified: u.emailVerified,
        createdAt: u.createdAt.toISOString(),
        companies: ownedMap.get(u.id) ?? 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
