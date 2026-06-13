import { integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { companies } from './companies.schema.js';

/** Documents processed per company per calendar month — basis for overage billing. */
export const monthlyUsage = pgTable(
  'monthly_usage',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Calendar month, 'YYYY-MM'. */
    period: text('period').notNull(),
    docCount: integer('doc_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('monthly_usage_company_period_uq').on(table.companyId, table.period)]
);

export type MonthlyUsage = typeof monthlyUsage.$inferSelect;
