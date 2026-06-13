import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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

interface InvoiceLine {
  description: string;
  quantity: number;
  unitPriceCzk: number;
  amountCzk: number;
}

/** Monthly subscription invoices issued to customers (one per company per period). */
export const invoices = pgTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    number: text('number').notNull().unique(),
    /** Billed period 'YYYY-MM'. */
    period: text('period').notNull(),
    issueDate: text('issue_date').notNull(),
    dueDate: text('due_date').notNull(),
    variableSymbol: text('variable_symbol').notNull(),
    customerName: text('customer_name').notNull(),
    customerIco: text('customer_ico'),
    customerAddress: text('customer_address'),
    recipientEmail: text('recipient_email').notNull(),
    overageDocs: integer('overage_docs').notNull().default(0),
    totalCzk: integer('total_czk').notNull(),
    lineItems: jsonb('line_items').$type<InvoiceLine[]>().notNull(),
    status: text('status').$type<'sent' | 'failed'>().notNull().default('sent'),
    errorMessage: text('error_message'),
    /** When the operator marked this invoice paid (null = unpaid). */
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('invoices_company_period_uq').on(table.companyId, table.period)]
);

export type Invoice = typeof invoices.$inferSelect;
export type { InvoiceLine };
