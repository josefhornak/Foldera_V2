# Foldera V2

Automatický most mezi příchozími fakturami a ABRA Flexi. Žádná správa dokumentů — aplikace monitoruje nakonfigurované zdroje (sběrný e-mail přes IMAP, OneDrive, Google Drive), automaticky vytěží přijaté faktury (Mistral OCR + ISDOC), zkontroluje duplicity a kontext v ABRA Flexi a doklad rovnou založí jako fakturu přijatou včetně přílohy s originálem. Soubory se v aplikaci nikam neukládají.

## Jak to funguje

```
IMAP schránka ─┐
OneDrive ──────┼─► poller (BullMQ) ─► vytěžení (Mistral OCR / ISDOC XML)
Google Drive ──┘                          │
                                          ▼
                          kontext z ABRA Flexi (dodavatel, předchozí
                          doklady → výchozí předpis zaúčtování, DPH…)
                                          │
                                          ▼
                          kontrola duplicit (hash + IČO/var. symbol v Abře)
                                          │
                                          ▼
                          POST faktura-prijata + nahrání originálu jako přílohy
                                          │
                                          ▼
                          záznam metadat v DB (seznam, statistiky, odkaz do Abry)
```

V UI je pouze: přihlášení, přepínač firem, dashboard se statistikami (počty, přesnost), tabulka zpracovaných dokladů s odkazem do ABRA Flexi a nastavení (ABRA Flexi připojení + zdroje dokumentů).

Vše se odesílá do Abry automaticky bez zásahu uživatele. Doklady s nízkou jistotou vytěžení jsou v seznamu pouze označeny. Pokud Abra doklad odmítne, zobrazí se chyba s možností opakovat export.

## Stack

- **Frontend**: React 19, React Router 7 (SPA), TypeScript, Tailwind CSS 4, Vite, SWR, Zustand
- **Backend**: Express 5, Drizzle ORM, PostgreSQL, Valkey (Redis), BullMQ
- **AI**: Mistral OCR (`mistral-ocr-latest`) + strukturovaná extrakce

## Vývoj

```bash
# Infrastruktura (PostgreSQL + Valkey)
docker compose up -d postgres valkey

# Backend
cd backend
cp .env.example .env   # doplňte MISTRAL_API_KEY, JWT_SECRET, APP_ENCRYPTION_KEY
npm install
npm run migrate
npm run dev            # API server na :3000
npm run dev:worker     # BullMQ worker + pollery

# Frontend (v rootu)
npm install
npm run dev            # Vite dev server na :5173
```

## Ověření

```bash
# Frontend
npm run lint && npm run typecheck && npm run test:run && npm run build

# Backend
cd backend && npm run lint && npx tsc --noEmit && npm test
```

## Konfigurace

| Proměnná | Popis |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Valkey/Redis URL (BullMQ, OAuth state) |
| `JWT_SECRET` | min. 32 znaků |
| `APP_ENCRYPTION_KEY` | 32 bajtů hex (64 znaků) — AES-256-GCM šifrování uložených přístupů (IMAP hesla, OAuth tokeny, ABRA hesla) |
| `MISTRAL_API_KEY` | klíč pro Mistral OCR |
| `GOOGLE_CLIENT_ID/SECRET` | OAuth pro Google Drive (volitelné) |
| `MICROSOFT_CLIENT_ID/SECRET` | OAuth pro OneDrive (volitelné) |
| `APP_BASE_URL` | veřejná URL aplikace (OAuth callbacky) |

## Deploy

`docker compose -f docker-compose.production.yml up -d` — viz `docker-compose.production.yml` (Nginx + API + worker + PostgreSQL + Valkey).
