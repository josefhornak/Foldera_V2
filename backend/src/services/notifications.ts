/**
 * Operational e-mail notifications to company admins. Currently: alert the
 * company's admins (správci) when a document fails to process or export, so a
 * failed doklad never silently stalls. Best-effort — never throws into the
 * pipeline; a mail outage must not break document processing.
 */
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';

import env from '../config/env.js';
import { db } from '../db/client.js';
import { companies, companyMembers, users, type Company } from '../db/schema/index.js';
import { TRIAL_DOC_LIMIT, decideBilling } from './billing.js';
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
 * Daily sweep: for every company whose free trial has ended — by time OR by
 * exhausting the free-doc quota — e-mail its admins that the trial is over and
 * ask them to confirm activation before going paid. Considers a company "ended"
 * when decideBilling no longer allows processing, so doc-exhausted trials are
 * caught too, not just time-expired ones. Marks trialEndNotifiedAt only AFTER
 * the send attempt so a transient mail outage retries next run rather than
 * silently dropping the e-mail. Notified once per company. Best-effort.
 */
export async function runTrialEndNotifications(): Promise<void> {
  const now = new Date();
  let candidates: Company[] = [];
  try {
    // SQL-bounded prefilter: only trials that have actually ended (time OR quota)
    // and weren't notified yet — keeps the daily job from loading every running
    // trial. decideBilling() below is the source-of-truth confirmation.
    candidates = await db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.billingStatus, 'trial'),
          isNull(companies.trialEndNotifiedAt),
          or(lte(companies.trialEndsAt, now), gte(companies.trialDocsUsed, TRIAL_DOC_LIMIT))
        )
      );
  } catch (error) {
    logger.error({ error: toError(error).message }, '[Notifications] Trial-end query failed');
    return;
  }

  const link = `${env.APP_BASE_URL.replace(/\/$/, '')}/settings/company`;
  for (const company of candidates) {
    if (decideBilling(company).allowed) continue; // belt-and-suspenders
    try {
      const admins = await adminEmails(company.id);
      const results = await Promise.all(
        admins.map((email) =>
          sendTrialEndedAlert(email, { companyName: company.name, link })
            .then(() => true)
            .catch((error) => {
              logger.error(
                { companyId: company.id, to: email, error: toError(error).message },
                '[Notifications] Failed to send trial-ended alert'
              );
              return false;
            })
        )
      );

      // Mark notified only once we've actually reached someone (or there is no
      // admin to reach). If every send failed — e.g. an SMTP outage — leave the
      // company unmarked so the next daily run retries instead of dropping it.
      if (admins.length === 0 || results.some(Boolean)) {
        await db
          .update(companies)
          .set({ trialEndNotifiedAt: new Date() })
          .where(eq(companies.id, company.id));
        logger.info({ companyId: company.id, admins: admins.length }, '[Notifications] Trial-ended alert sent');
      } else {
        logger.warn(
          { companyId: company.id, admins: admins.length },
          '[Notifications] Trial-ended alert failed for all admins — will retry next run'
        );
      }
    } catch (error) {
      logger.error(
        { companyId: company.id, error: toError(error).message },
        '[Notifications] runTrialEndNotifications failed for company'
      );
    }
  }
}
