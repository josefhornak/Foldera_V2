import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { companies } from './companies.schema.js';
import { users } from './users.schema.js';

/** A company can be shared by several users. 'admin' = správce (full control),
 *  'member' = běžný uživatel (read-only — only views). The company creator is
 *  added as an admin automatically. */
export const companyMembers = pgTable(
  'company_members',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<'admin' | 'member'>().notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('company_members_company_user_uq').on(table.companyId, table.userId),
    index('company_members_user_idx').on(table.userId),
  ]
);

/** Pending e-mail invitations to join a company with a given role. */
export const companyInvitations = pgTable(
  'company_invitations',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').$type<'admin' | 'member'>().notNull().default('member'),
    token: text('token').notNull().unique(),
    invitedByUserId: text('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('company_invitations_company_idx').on(table.companyId)]
);

export type CompanyMember = typeof companyMembers.$inferSelect;
export type CompanyRole = CompanyMember['role'];
export type CompanyInvitation = typeof companyInvitations.$inferSelect;
