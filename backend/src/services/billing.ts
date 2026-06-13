/**
 * Billing: trial / subscription state, document metering and limit decisions.
 *
 * Pricing: 7-day / 10-document free trial → then 99 Kč/měsíc per company with 50
 * documents included, each extra document 2 Kč (notify but keep running).
 * Invoiced monthly (see the monthly invoice job). One subscription per company.
 */
import { and, eq, gt, lt, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { companies, monthlyUsage, type Company } from '../db/schema/index.js';
import { generateId } from '../utils/ids.js';

export const PLAN_PRICE_CZK = 99;
export const INCLUDED_DOCS = 50;
export const OVERAGE_CZK = 2;
export const TRIAL_DAYS = 7;
export const TRIAL_DOC_LIMIT = 10;

/** Calendar month 'YYYY-MM' (UTC). */
export function currentPeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export async function getMonthlyCount(companyId: string, period = currentPeriod()): Promise<number> {
  const [row] = await db
    .select({ c: monthlyUsage.docCount })
    .from(monthlyUsage)
    .where(and(eq(monthlyUsage.companyId, companyId), eq(monthlyUsage.period, period)))
    .limit(1);
  return row?.c ?? 0;
}

export type BlockReason = 'trial_expired' | 'trial_docs' | 'cancelled';
export interface BillingDecision {
  allowed: boolean;
  reason?: BlockReason;
}

/** Decide whether a company may process another document right now. */
export function decideBilling(company: Pick<Company, 'billingStatus' | 'trialEndsAt' | 'trialDocsUsed'>): BillingDecision {
  if (company.billingStatus === 'active') return { allowed: true };
  if (company.billingStatus === 'cancelled') return { allowed: false, reason: 'cancelled' };
  // trial
  const trialEnded = !company.trialEndsAt || company.trialEndsAt.getTime() < Date.now();
  if (trialEnded) return { allowed: false, reason: 'trial_expired' };
  if (company.trialDocsUsed >= TRIAL_DOC_LIMIT) return { allowed: false, reason: 'trial_docs' };
  return { allowed: true };
}

/**
 * Atomically reserve a processing slot BEFORE the expensive OCR step.
 *
 * For trial companies this is a single conditional UPDATE that increments
 * `trialDocsUsed` only while the trial is live and under the limit, so two
 * concurrent jobs can never both pass at `trialDocsUsed = 9` (the race that a
 * read-then-write check left open). Active plans have no hard cap (overage is
 * billed, not blocked); cancelled companies are rejected.
 */
export async function consumeBillingSlot(
  company: Pick<Company, 'id' | 'billingStatus'>
): Promise<BillingDecision> {
  if (company.billingStatus === 'active') return { allowed: true };
  if (company.billingStatus === 'cancelled') return { allowed: false, reason: 'cancelled' };

  // trial — reserve the slot atomically.
  const reserved = await db
    .update(companies)
    .set({ trialDocsUsed: sql`${companies.trialDocsUsed} + 1` })
    .where(
      and(
        eq(companies.id, company.id),
        eq(companies.billingStatus, 'trial'),
        gt(companies.trialEndsAt, new Date()),
        lt(companies.trialDocsUsed, TRIAL_DOC_LIMIT)
      )
    )
    .returning({ id: companies.id });
  if (reserved.length > 0) return { allowed: true };

  // Blocked — distinguish "trial window over" from "free docs used up".
  const [c] = await db
    .select({ trialEndsAt: companies.trialEndsAt, trialDocsUsed: companies.trialDocsUsed })
    .from(companies)
    .where(eq(companies.id, company.id))
    .limit(1);
  const trialEnded = !c?.trialEndsAt || c.trialEndsAt.getTime() < Date.now();
  return { allowed: false, reason: trialEnded ? 'trial_expired' : 'trial_docs' };
}

export function blockMessage(reason: BlockReason): string {
  switch (reason) {
    case 'trial_expired':
      return 'Zkušební období skončilo. Aktivujte předplatné v Nastavení, aby se doklady zase zpracovávaly.';
    case 'trial_docs':
      return `Vyčerpali jste ${TRIAL_DOC_LIMIT} dokladů zdarma ze zkušebního období. Aktivujte předplatné v Nastavení.`;
    case 'cancelled':
      return 'Předplatné je zrušené. Obnovte ho v Nastavení, aby se doklady zase zpracovávaly.';
  }
}

/**
 * Record one processed document toward the monthly usage counter (drives
 * invoicing). The trial counter is incremented atomically up-front by
 * {@link consumeBillingSlot}, so it is intentionally not touched here.
 */
export async function recordDocumentUsage(company: Pick<Company, 'id'>): Promise<void> {
  const period = currentPeriod();
  await db
    .insert(monthlyUsage)
    .values({ id: generateId('usg'), companyId: company.id, period, docCount: 1 })
    .onConflictDoUpdate({
      target: [monthlyUsage.companyId, monthlyUsage.period],
      set: { docCount: sql`${monthlyUsage.docCount} + 1`, updatedAt: new Date() },
    });
}

export interface BillingSummary {
  status: Company['billingStatus'];
  trialEndsAt: string | null;
  trialDocsUsed: number;
  trialDocLimit: number;
  blocked: boolean;
  blockReason: BlockReason | null;
  period: string;
  used: number;
  included: number;
  overage: number;
  overageCostCzk: number;
  estimatedTotalCzk: number;
  planPriceCzk: number;
}

export async function getBillingSummary(company: Company): Promise<BillingSummary> {
  const period = currentPeriod();
  const used = await getMonthlyCount(company.id, period);
  const decision = decideBilling(company);
  const overage = company.billingStatus === 'active' ? Math.max(0, used - INCLUDED_DOCS) : 0;
  const overageCostCzk = overage * OVERAGE_CZK;
  const estimatedTotalCzk = company.billingStatus === 'active' ? PLAN_PRICE_CZK + overageCostCzk : 0;
  return {
    status: company.billingStatus,
    trialEndsAt: company.trialEndsAt ? company.trialEndsAt.toISOString() : null,
    trialDocsUsed: company.trialDocsUsed,
    trialDocLimit: TRIAL_DOC_LIMIT,
    blocked: !decision.allowed,
    blockReason: decision.reason ?? null,
    period,
    used,
    included: INCLUDED_DOCS,
    overage,
    overageCostCzk,
    estimatedTotalCzk,
    planPriceCzk: PLAN_PRICE_CZK,
  };
}
