import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  locale: text('locale').notNull().default('cs'),
  // E-mail verification (6-digit code) during signup.
  emailVerified: boolean('email_verified').notNull().default(false),
  verifyCode: text('verify_code'),
  verifyCodeExpires: timestamp('verify_code_expires', { withTimezone: true }),
  /** Wrong-code attempts for the current verifyCode; the code is invalidated past a cap. */
  verifyAttempts: integer('verify_attempts').notNull().default(0),
  // Password reset (6-digit code). Deliberately separate from the verify* fields
  // above: sharing them would let a reset code double as proof of e-mail
  // ownership, verifying an address the requester may not actually control.
  resetCode: text('reset_code'),
  resetCodeExpires: timestamp('reset_code_expires', { withTimezone: true }),
  /** Wrong-code attempts for the current resetCode; the code is invalidated past a cap. */
  resetAttempts: integer('reset_attempts').notNull().default(0),
  /** When this user first started a free trial — gates one trial per account (not per company). */
  trialStartedAt: timestamp('trial_started_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
