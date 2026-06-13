/**
 * Operator-only invoices overview: list every issued subscription invoice and
 * mark payments. Cross-tenant by design (the operator bills all customers) and
 * gated by requireAdmin.
 */
import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';

import { db } from '../db/client.js';
import { invoices } from '../db/schema/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { AppError, ErrorCodes } from '../utils/errors.js';

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

export default router;
