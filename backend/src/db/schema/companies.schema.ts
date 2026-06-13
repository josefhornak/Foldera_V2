import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { users } from './users.schema.js';

/**
 * A company = one ABRA Flexi connection + its document sources.
 * One user can own multiple companies and switches between them in the UI.
 * Nothing except the login is shared between companies.
 */
export const companies = pgTable(
  'companies',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ico: text('ico'),

    // ABRA Flexi connection — password encrypted with AES-256-GCM
    abraApiUrl: text('abra_api_url'),
    abraApiUser: text('abra_api_user'),
    abraApiPasswordEnc: text('abra_api_password_enc'),

    // How accounting fields (řádek DPH …) are filled when the supplier has no
    // history to harvest from: 'history' = leave empty, 'ai' = let the model
    // pick a code from the company's ABRA číselník. History always wins.
    accountingFillMode: text('accounting_fill_mode')
      .$type<'history' | 'ai'>()
      .notNull()
      .default('history'),

    // Billing. trial → free 7 days / 10 docs, then blocked until active.
    billingStatus: text('billing_status')
      .$type<'trial' | 'active' | 'cancelled'>()
      .notNull()
      .default('trial'),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    /** Documents processed during the trial (lifetime, capped at 10). */
    trialDocsUsed: integer('trial_docs_used').notNull().default(0),
    /** When the paid subscription was activated (drives which months are billed). */
    subscriptionStartedAt: timestamp('subscription_started_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('companies_user_id_idx').on(table.userId)]
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
