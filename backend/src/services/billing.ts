/**
 * Billing: trial / subscription state, document metering and limit decisions.
 *
 * Pricing: 7-day / 10-document free trial → then 199 Kč/měsíc per company with 100
 * documents included, each extra document 2 Kč (notify but keep running).
 * Invoiced monthly (see the monthly invoice job). One subscription per company.
 */
import { and, eq, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { companies, monthlyUsage, type Company } from '../db/schema/index.js';
import { generateId } from '../utils/ids.js';

export const PLAN_PRICE_CZK = 199;
export const INCLUDED_DOCS = 100;
export const OVERAGE_CZK = 2;
export const TRIAL_DAYS = 7;
export const TRIAL_DOC_LIMIT = 10;

/** Calendar month 'YYYY-MM' (UTC). */
export function currentPeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Strip the time so period math compares whole days (UTC midnight). */
function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Add n months to a date, clamping the day to the target month's length. */
function addMonths(date: Date, n: number): Date {
  const day = date.getUTCDate();
  const base = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base;
}

/**
 * Anniversary billing periods are anchored on `subscriptionStartedAt`, not the
 * calendar — subscribe on the 29th and your month runs 29th→28th. This returns
 * the start of the period that contains `on`.
 */
export function billingPeriodStart(anchor: Date, on = new Date()): Date {
  const a = dateOnly(anchor);
  let months = (on.getUTCFullYear() - a.getUTCFullYear()) * 12 + (on.getUTCMonth() - a.getUTCMonth());
  if (addMonths(a, months).getTime() > on.getTime()) months -= 1;
  return addMonths(a, months);
}

/** The date the next invoice will be issued (start of the next anniversary period). */
export function nextBillingDate(anchor: Date, on = new Date()): Date {
  return addMonths(billingPeriodStart(anchor, on), 1);
}

/**
 * The most recently COMPLETED anniversary period as of `on`, or null if the
 * first full month hasn't elapsed yet (so a mid-month signup is never billed
 * for a partial period).
 */
export function completedBillingPeriod(anchor: Date, on = new Date()): { start: Date; end: Date; key: string } | null {
  const a = dateOnly(anchor);
  const currentStart = billingPeriodStart(a, on);
  const completedStart = addMonths(currentStart, -1);
  if (completedStart.getTime() < a.getTime()) return null;
  return { start: completedStart, end: currentStart, key: isoDate(completedStart) };
}

/**
 * Usage/billing period key for a company. Active subscriptions count usage per
 * anniversary period (key = period-start date); trial/other use the calendar
 * month (trial isn't billed, so the exact key only feeds the display).
 */
export function periodKey(
  company: Pick<Company, 'billingStatus' | 'subscriptionStartedAt'>,
  on = new Date()
): string {
  if (company.billingStatus === 'active' && company.subscriptionStartedAt) {
    return isoDate(billingPeriodStart(company.subscriptionStartedAt, on));
  }
  return currentPeriod(on);
}

export async function getMonthlyCount(companyId: string, period = currentPeriod()): Promise<number> {
  const [row] = await db
    .select({ c: monthlyUsage.docCount })
    .from(monthlyUsage)
    .where(and(eq(monthlyUsage.companyId, companyId), eq(monthlyUsage.period, period)))
    .limit(1);
  return row?.c ?? 0;
}

export type BlockReason = 'trial_expired' | 'trial_docs' | 'cancelled' | 'subscription_required';
export interface BillingDecision {
  allowed: boolean;
  reason?: BlockReason;
}

/** Decide whether a company may process another document right now. */
export function decideBilling(company: Pick<Company, 'billingStatus' | 'trialEndsAt' | 'trialDocsUsed'>): BillingDecision {
  if (company.billingStatus === 'active') return { allowed: true };
  if (company.billingStatus === 'cancelled') return { allowed: false, reason: 'cancelled' };
  // Additional company — never had a trial, must subscribe.
  if (company.billingStatus === 'awaiting_subscription') return { allowed: false, reason: 'subscription_required' };
  // trial
  const trialEnded = !company.trialEndsAt || company.trialEndsAt.getTime() < Date.now();
  if (trialEnded) return { allowed: false, reason: 'trial_expired' };
  if (company.trialDocsUsed >= TRIAL_DOC_LIMIT) return { allowed: false, reason: 'trial_docs' };
  return { allowed: true };
}

export function blockMessage(reason: BlockReason): string {
  switch (reason) {
    case 'trial_expired':
      return 'Zkušební období skončilo. Aktivujte předplatné v Nastavení, aby se doklady zase zpracovávaly.';
    case 'trial_docs':
      return `Vyčerpali jste ${TRIAL_DOC_LIMIT} dokladů zdarma ze zkušebního období. Aktivujte předplatné v Nastavení.`;
    case 'cancelled':
      return 'Předplatné je zrušené. Obnovte ho v Nastavení, aby se doklady zase zpracovávaly.';
    case 'subscription_required':
      return 'Pro tuto firmu aktivujte předplatné v Nastavení, aby se doklady zpracovávaly.';
  }
}

/**
 * Record ONE document that was actually sent to ABRA Flexi (status EXPORTED).
 * Only exported documents count toward usage — duplicates, non-invoices and
 * failed exports are free. Increments the monthly usage counter (drives
 * invoicing) and, during the trial, the trial counter.
 */
export async function recordDocumentUsage(
  company: Pick<Company, 'id' | 'billingStatus' | 'subscriptionStartedAt'>
): Promise<void> {
  const period = periodKey(company);
  await db
    .insert(monthlyUsage)
    .values({ id: generateId('usg'), companyId: company.id, period, docCount: 1 })
    .onConflictDoUpdate({
      target: [monthlyUsage.companyId, monthlyUsage.period],
      set: { docCount: sql`${monthlyUsage.docCount} + 1`, updatedAt: new Date() },
    });
  if (company.billingStatus === 'trial') {
    await db
      .update(companies)
      .set({ trialDocsUsed: sql`${companies.trialDocsUsed} + 1` })
      .where(eq(companies.id, company.id));
  }
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
  /** ISO date the next invoice will be issued (active only), else null. */
  nextInvoiceDate: string | null;
}

export async function getBillingSummary(company: Company): Promise<BillingSummary> {
  const period = periodKey(company);
  const used = await getMonthlyCount(company.id, period);
  const decision = decideBilling(company);
  const overage = company.billingStatus === 'active' ? Math.max(0, used - INCLUDED_DOCS) : 0;
  const overageCostCzk = overage * OVERAGE_CZK;
  const estimatedTotalCzk = company.billingStatus === 'active' ? PLAN_PRICE_CZK + overageCostCzk : 0;
  const nextInvoiceDate =
    company.billingStatus === 'active' && company.subscriptionStartedAt
      ? isoDate(nextBillingDate(company.subscriptionStartedAt))
      : null;
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
    nextInvoiceDate,
  };
}
