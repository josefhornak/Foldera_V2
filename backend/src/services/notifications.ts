/**
 * Operational e-mail notifications to company admins. Currently: alert the
 * company's admins (správci) when a document fails to process or export, so a
 * failed doklad never silently stalls. Best-effort — never throws into the
 * pipeline; a mail outage must not break document processing.
 */
import { and, eq, isNull, lte } from 'drizzle-orm';

import env from '../config/env.js';
import { db } from '../db/client.js';
import { companies, companyMembers, users, type Company } from '../db/schema/index.js';
import { sendDocumentFailureAlert, sendTrialEndedAlert } from '../utils/email.js';
import { logger } from '../utils/logger.js';
import { toError } from '../utils/errors.js';

/** All admin (správce) e-mail addresses for a company. */
async function adminEmails(companyId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.role, 'admin')));
  return rows.map((r) => r.email);
}

export interface DocumentFailure {
  fileName: string;
  supplierName?: string | null;
  totalAmount?: string | null;
  currency?: string | null;
  /** 'export' = ABRA Flexi rejected it; 'processing' = extraction failed. */
  phase: 'export' | 'processing';
  errorMessage?: string | null;
}

/** E-mail every admin of the company that a document failed. Never throws. */
export async function notifyDocumentFailure(company: Company, failure: DocumentFailure): Promise<void> {
  try {
    const admins = await adminEmails(company.id);
    if (!admins.length) return;

    const link = `${env.APP_BASE_URL.replace(/\/$/, '')}/documents`;
    const amount =
      failure.totalAmount && failure.currency
        ? `${failure.totalAmount} ${failure.currency}`
        : failure.totalAmount ?? null;

    await Promise.all(
      admins.map((email) =>
        sendDocumentFailureAlert(email, {
          companyName: company.name,
          fileName: failure.fileName,
          supplierName: failure.supplierName,
          amount,
          phase: failure.phase,
          errorMessage: failure.errorMessage,
          link,
        }).catch((error) =>
          logger.error(
            { companyId: company.id, to: email, error: toError(error).message },
            '[Notifications] Failed to send failure alert'
          )
        )
      )
    );
  } catch (error) {
    logger.error(
      { companyId: company.id, error: toError(error).message },
      '[Notifications] notifyDocumentFailure threw'
    );
  }
}

/**
 * Daily sweep: for every company whose free trial has just ended (still on the
 * 'trial' status, trialEndsAt in the past, not yet notified), e-mail its admins
 * that the trial is over and ask them to confirm activation before going paid.
 * Marks trialEndNotifiedAt so each company is notified only once. Best-effort.
 */
export async function runTrialEndNotifications(): Promise<void> {
  const now = new Date();
  let expired: Company[] = [];
  try {
    expired = await db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.billingStatus, 'trial'),
          lte(companies.trialEndsAt, now),
          isNull(companies.trialEndNotifiedAt)
        )
      );
  } catch (error) {
    logger.error({ error: toError(error).message }, '[Notifications] Trial-end query failed');
    return;
  }

  const link = `${env.APP_BASE_URL.replace(/\/$/, '')}/settings/company`;
  for (const company of expired) {
    try {
      const admins = await adminEmails(company.id);
      // Mark as notified even with no admins, so we don't re-scan it forever.
      await db
        .update(companies)
        .set({ trialEndNotifiedAt: new Date() })
        .where(eq(companies.id, company.id));
      if (!admins.length) continue;
      await Promise.all(
        admins.map((email) =>
          sendTrialEndedAlert(email, { companyName: company.name, link }).catch((error) =>
            logger.error(
              { companyId: company.id, to: email, error: toError(error).message },
              '[Notifications] Failed to send trial-ended alert'
            )
          )
        )
      );
      logger.info({ companyId: company.id, admins: admins.length }, '[Notifications] Trial-ended alert sent');
    } catch (error) {
      logger.error(
        { companyId: company.id, error: toError(error).message },
        '[Notifications] runTrialEndNotifications failed for company'
      );
    }
  }
}
