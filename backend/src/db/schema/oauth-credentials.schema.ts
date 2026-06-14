import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { companies } from './companies.schema.js';

/**
 * Per-company OAuth app credentials for cloud drive sources. Each company brings
 * its OWN Google Cloud / Azure OAuth app (client id + secret) — entered in the
 * UI with an on-page guide — so Foldera never operates a central multi-tenant
 * app. The client secret is encrypted at rest (AES-256-GCM via encryptSecret).
 */
export const oauthCredentials = pgTable(
  'oauth_credentials',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** 'google_drive' | 'onedrive' */
    provider: text('provider').$type<'google_drive' | 'onedrive'>().notNull(),
    clientId: text('client_id').notNull(),
    /** AES-256-GCM encrypted client secret. */
    clientSecretEnc: text('client_secret_enc').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('oauth_credentials_company_provider_uq').on(t.companyId, t.provider),
    index('oauth_credentials_company_idx').on(t.companyId),
  ],
);

export type OAuthCredentialRow = typeof oauthCredentials.$inferSelect;
