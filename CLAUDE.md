# CLAUDE.md

Foldera V2 — automatic bridge between incoming purchase invoices and ABRA Flexi. Watches configured sources (collection IMAP mailbox, OneDrive, Google Drive), extracts invoices with Mistral OCR (+ ISDOC ground truth), checks duplicates and supplier context in ABRA Flexi, and creates the faktura-prijata automatically with the original file attached. Files are NEVER stored by the app — only extraction metadata. Everything is automatic; low confidence is only flagged, ABRA rejections are retryable from stored extraction data.

## Stack

- **Frontend**: React 19, React Router 7 (SPA, `ssr: false`), TypeScript, Tailwind CSS 4, Vite, SWR, Zustand
- **Backend**: Express 5, Drizzle ORM, PostgreSQL, Valkey (Redis), BullMQ
- **Testing**: Vitest (both frontend and backend)

## Structure

```
app/                    # Frontend (path alias ~/ -> app/)
public/locales/         # i18n — cs (primary), en
backend/src/
  config/env.ts         # Zod-validated env
  db/schema/            # users, companies, sources, documents
  middleware/           # auth (JWT via jose), companyScope, errorHandler
  routes/               # auth, companies, documents, sources, oauth
  services/
    extraction/         # Mistral OCR + ISDOC -> ExtractedInvoice
    abraflexi/          # ABRA Flexi REST client (export, attachments, context)
    sources/            # IMAP (imapflow), OneDrive, Google Drive pollers
  queue/
    pipeline.ts         # processIncomingFile / retryExport orchestration
    queues.ts           # BullMQ queues (poll-sources, process-document, export-retry)
  types/contracts.ts    # SINGLE SOURCE OF TRUTH for inter-module interfaces
  index.ts              # API server
  worker.ts             # BullMQ worker + repeatable source polling
```

## Commands

```bash
# Frontend (root)
npm run lint && npm run typecheck && npm run test:run && npm run build

# Backend (cd backend/)
npm run lint && npx tsc --noEmit && npm test
npm run generate   # drizzle-kit generate (after schema changes)
npm run migrate    # drizzle-kit migrate
```

## Verification

Before considering any task complete: frontend `npm run lint && npm run typecheck && npm run test:run && npm run build`; backend `cd backend && npm run lint && npx tsc --noEmit && npm test`.

## Conventions

- TypeScript strict, no `any`, no `@ts-ignore`; `as const` objects instead of `enum`
- Backend: ESM with `.js` import suffixes (NodeNext), Zod request validation, Drizzle for all DB access
- All user-facing text via i18n keys — update BOTH `public/locales/cs` and `en`
- Conventional commits (`feat:`, `fix:`, …)
- Financial rounding: `Math.round(v * 100) / 100`
- LIKE queries: `escapeLikePattern()` from `backend/src/utils/sqlUtils.ts`
- ID prefixes via `generateId()`: `usr`, `cmp`, `src`, `doc`

## Key invariants

- **Files are ephemeral**: downloaded to `os.tmpdir()/foldera-v2`, deleted in pipeline `finally`. Only `documents.extracted` JSONB survives (enables export retry + detail view).
- **Company scoping**: every documents/sources query includes `companyId` in WHERE (defense-in-depth on top of `requireCompany`).
- **Secrets at rest** (IMAP passwords, OAuth tokens, ABRA passwords) are AES-256-GCM encrypted via `utils/crypto.ts` (`APP_ENCRYPTION_KEY`). Never return them from APIs.
- **Dedup**: unique `(companyId, contentHash)` + ABRA-side duplicate check (same supplier IČO + var. symbol/invoice number) before export.
- **Attachment failure never flips a successful export** — the document stays `exported` with a note.
- **Retry** re-exports from stored extraction; the original file is gone, so no attachment on retry.
- `types/contracts.ts` defines module interfaces — change it first, then implementations.
- Backend tests need env: see `backend/vitest.config.ts` (provides test env vars automatically).

## Document statuses

`processing` → `exported` | `export_failed` (retryable) | `extraction_failed` | `skipped_duplicate` | `skipped_not_invoice`
