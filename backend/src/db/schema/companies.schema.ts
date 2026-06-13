import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

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

    // Billing: free trial end (set on creation). Subscription state lands here later.
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('companies_user_id_idx').on(table.userId)]
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
