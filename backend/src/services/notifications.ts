/**
 * Operational e-mail notifications to company admins. Currently: alert the
 * company's admins (správci) when a document fails to process or export, so a
 * failed doklad never silently stalls. Best-effort — never throws into the
 * pipeline; a mail outage must not break document processing.
 */
import { and, eq } from 'drizzle-orm';

import env from '../config/env.js';
import { db } from '../db/client.js';
import { companyMembers, users, type Company } from '../db/schema/index.js';
import { sendDocumentFailureAlert } from '../utils/email.js';
import { logger } from '../utils/logger.js';
import { toError } from '../utils/errors.js';

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
    const admins = await db
      .select({ email: users.email })
      .from(companyMembers)
      .innerJoin(users, eq(users.id, companyMembers.userId))
      .where(and(eq(companyMembers.companyId, company.id), eq(companyMembers.role, 'admin')));
    if (!admins.length) return;

    const link = `${env.APP_BASE_URL.replace(/\/$/, '')}/documents`;
    const amount =
      failure.totalAmount && failure.currency
        ? `${failure.totalAmount} ${failure.currency}`
        : failure.totalAmount ?? null;

    await Promise.all(
      admins.map((a) =>
        sendDocumentFailureAlert(a.email, {
          companyName: company.name,
          fileName: failure.fileName,
          supplierName: failure.supplierName,
          amount,
          phase: failure.phase,
          errorMessage: failure.errorMessage,
          link,
        }).catch((error) =>
          logger.error(
            { companyId: company.id, to: a.email, error: toError(error).message },
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
