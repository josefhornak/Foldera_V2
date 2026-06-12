import { boolean, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { companies } from './companies.schema.js';

export const SOURCE_TYPE = {
  IMAP: 'imap',
  ONEDRIVE: 'onedrive',
  GOOGLE_DRIVE: 'google_drive',
} as const;

export type SourceType = (typeof SOURCE_TYPE)[keyof typeof SOURCE_TYPE];

export const SOURCE_STATUS = {
  OK: 'ok',
  ERROR: 'error',
  PENDING_AUTH: 'pending_auth',
} as const;

export type SourceStatus = (typeof SOURCE_STATUS)[keyof typeof SOURCE_STATUS];

/** IMAP config stored in `config` JSONB. Password is AES-256-GCM encrypted. */
export interface ImapSourceConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  passwordEnc: string;
  folder: string; // mailbox to watch, default 'INBOX'
}

/** Drive config stored in `config` JSONB. Tokens are AES-256-GCM encrypted. */
export interface DriveSourceConfig {
  accountEmail: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  tokenExpiresAt: number; // unix ms
  folderId: string;
  folderPath: string;
}

export type SourceConfig = ImapSourceConfig | DriveSourceConfig;

/** Poll cursor stored in `cursor` JSONB — provider-specific. */
export interface SourceCursor {
  /** IMAP: highest processed UID */
  lastUid?: number;
  /** IMAP: UIDVALIDITY of the mailbox the lastUid belongs to */
  uidValidity?: string;
  /** OneDrive: Graph delta link */
  deltaLink?: string;
  /** Google Drive: last seen modifiedTime (ISO) */
  lastModifiedTime?: string;
  /** Drive: file IDs already processed (bounded, most recent first) */
  seenFileIds?: string[];
}

export const sources = pgTable(
  'sources',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    type: text('type').$type<SourceType>().notNull(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config').$type<SourceConfig>().notNull(),
    cursor: jsonb('cursor').$type<SourceCursor>().notNull().default({}),
    status: text('status').$type<SourceStatus>().notNull().default('ok'),
    lastError: text('last_error'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sources_company_id_idx').on(table.companyId)]
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
