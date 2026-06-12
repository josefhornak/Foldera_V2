# Foldera V2

Automatický most mezi příchozími fakturami a **ABRA Flexi**. Aplikace monitoruje nakonfigurované zdroje dokumentů, automaticky vytěží přijaté faktury, zkontroluje duplicity a kontext v ABRA Flexi a doklad rovnou založí jako **fakturu přijatou** včetně přílohy s originálem — **bez jakéhokoliv zásahu uživatele**.

Soubory se v aplikaci **nikam neukládají**: existují jen dočasně během zpracování, pak putují jako příloha do Abry a lokálně se smažou. V databázi zůstávají pouze vytěžená metadata (kvůli seznamu, statistikám a možnosti opakovat export).

## Funkce

- **Zdroje dokumentů**
  - 📧 Sběrný e-mail — libovolná IMAP schránka (host/port/login/heslo), kontrola každých 5 minut
  - ☁️ OneDrive — OAuth připojení, sledování zvolené složky
  - ☁️ Google Drive — OAuth připojení, sledování zvolené složky
  - 🖱️ Ruční nahrání — drag & drop přímo v aplikaci (PDF, obrázky, ISDOC, XML, max. 25 MB)
- **Vytěžování** — Mistral OCR (`mistral-ocr-latest`) + strukturovaná extrakce; ISDOC/Peppol UBL XML slouží jako ground truth (přesnost 95+); skóre spolehlivosti 0–100 (kontrolní součet IČO, validita dat, konzistence DPH vs. celková částka)
- **Kontext z ABRA Flexi** — před exportem se dohledá dodavatel podle IČO a z jeho posledních faktur se převezmou výchozí hodnoty: typ dokladu, předpis zaúčtování, členění DPH, středisko, forma úhrady
- **Kontrola duplicit** — dvojitá: hash obsahu souboru (v aplikaci) + dotaz do Abry (stejné IČO dodavatele a var. symbol / číslo došlé faktury)
- **Export do Abry** — založení `faktura-prijata` přes REST API (správné DPH režimy včetně přenesené daňové povinnosti a cizích měn, automatické založení dodavatele v adresáři) + nahrání originálu jako přílohy
- **Vše automaticky** — nízká přesnost vytěžení se v seznamu pouze označí; pokud Abra doklad odmítne, zobrazí se chyba s tlačítkem „Opakovat export"
- **Více firem pod jedním účtem** — každá firma má vlastní ABRA Flexi připojení a vlastní zdroje, mezi firmami se přepíná v UI

## Jak to funguje

```
IMAP schránka ──┐
OneDrive ───────┼─► poller (BullMQ, à 5 min) ─┐
Google Drive ───┘                             │
Drag & drop ──────────────────────────────────┤
                                              ▼
                            dedup hashem obsahu (companyId + sha256)
                                              ▼
                            vytěžení — Mistral OCR / ISDOC XML
                                              ▼
                            klasifikace: faktura přijatá? (jinak přeskočit)
                                              ▼
                            ABRA Flexi: duplicita? (IČO + VS) → přeskočit
                                              ▼
                            ABRA Flexi: dodavatel + výchozí hodnoty
                            z jeho předchozích dokladů
                                              ▼
                            POST faktura-prijata + příloha s originálem
                                              ▼
                            smazání souboru, záznam metadat do DB
```

## UI

Záměrně minimální — čtyři obrazovky:

| Stránka | Obsah |
|---|---|
| **Přihlášení** | e-mail + heslo, registrace |
| **Přehled** | zpracováno celkem / za 30 dní, úspěšnost exportu, průměrná přesnost, chyby k vyřešení, poslední dokumenty |
| **Dokumenty** | drag & drop nahrání, tabulka dokladů (dodavatel, číslo, částka, přesnost, stav), odkaz do Abry, opakování exportu, detail s vytěženými daty |
| **Nastavení** | ABRA Flexi připojení + test, zdroje dokumentů (IMAP / OneDrive / GDrive + výběr složky), údaje firmy |

## Stack

- **Frontend**: React 19, React Router 7 (SPA, `ssr: false`), TypeScript, Tailwind CSS 4, Vite, SWR, Zustand, i18next (čeština primární, angličtina)
- **Backend**: Express 5, Drizzle ORM, PostgreSQL, Valkey (Redis), BullMQ
- **AI**: Mistral OCR + chat completions
- **Testy**: Vitest (frontend i backend)

## Struktura repozitáře

```
app/                    # Frontend (alias ~/ -> app/)
public/locales/         # Překlady — cs (primární), en
backend/src/
  config/env.ts         # Zod-validované prostředí
  db/schema/            # users, companies, sources, documents
  middleware/           # auth (JWT), companyScope, errorHandler
  routes/               # auth, companies, documents (+ upload), sources, oauth
  services/
    extraction/         # Mistral OCR + ISDOC -> ExtractedInvoice
    abraflexi/          # ABRA Flexi REST klient (export, přílohy, kontext)
    sources/            # IMAP, OneDrive, Google Drive pollery
  queue/
    pipeline.ts         # orchestrace zpracování dokumentu
    queues.ts           # BullMQ fronty
  types/contracts.ts    # rozhraní mezi moduly (single source of truth)
  index.ts              # API server (v produkci servíruje i SPA)
  worker.ts             # BullMQ worker + plánované pollování zdrojů
```

## Lokální vývoj

Požadavky: Node 22+, Docker.

```bash
# 1. Infrastruktura (PostgreSQL + Valkey)
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env        # doplňte JWT_SECRET, APP_ENCRYPTION_KEY, MISTRAL_API_KEY
npm install
npm run migrate             # vytvoří DB schéma
npm run dev                 # API server na :3000
npm run dev:worker          # (druhý terminál) worker + pollery

# 3. Frontend (v rootu repa)
npm install
npm run dev                 # Vite dev server na :5173 (proxy /api -> :3000)
```

## Konfigurace (backend/.env)

| Proměnná | Povinná | Popis |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Valkey/Redis (BullMQ fronty, OAuth state) |
| `JWT_SECRET` | ✅ | min. 32 znaků |
| `APP_ENCRYPTION_KEY` | ✅ | 64 hex znaků (`openssl rand -hex 32`) — AES-256-GCM šifrování uložených přístupů (IMAP hesla, OAuth tokeny, ABRA hesla) |
| `MISTRAL_API_KEY` | ✅ | klíč pro Mistral OCR ([console.mistral.ai](https://console.mistral.ai)) |
| `APP_BASE_URL` | ✅ | veřejná URL aplikace (CORS, OAuth callbacky) |
| `GOOGLE_CLIENT_ID/SECRET` | – | OAuth pro Google Drive zdroj |
| `MICROSOFT_CLIENT_ID/SECRET` | – | OAuth pro OneDrive zdroj |
| `SOURCE_POLL_INTERVAL_MIN` | – | interval kontroly zdrojů (výchozí 5 min) |
| `PORT` | – | port API serveru (výchozí 3000) |

### Registrace OAuth aplikací (volitelné — jen pro Drive zdroje)

- **Google Drive**: [Google Cloud Console](https://console.cloud.google.com) → OAuth client (Web) → redirect URI `{APP_BASE_URL}/api/oauth/google_drive/callback`, scope `drive.readonly`
- **OneDrive**: [Azure Portal](https://portal.azure.com) → App registration → redirect URI `{APP_BASE_URL}/api/oauth/onedrive/callback`, delegated permissions `Files.Read.All`, `User.Read`, `offline_access`

Bez nich funguje IMAP zdroj a ruční nahrávání samostatně.

## Nasazení na server

```bash
git clone <repo> && cd Foldera_V2
cp backend/.env.example backend/.env    # vyplňte produkční hodnoty
export POSTGRES_PASSWORD=<silné-heslo>
docker compose -f docker-compose.production.yml up -d --build

# migrace DB (jednorázově po prvním startu / po každém update)
docker compose -f docker-compose.production.yml exec api \
  npx drizzle-kit migrate
```

Produkční sestava: `api` (Express + SPA na :3000, jen localhost — předřaďte Nginx/Caddy s TLS), `worker` (BullMQ + pollery), `postgres`, `valkey`. Kontejnery `api` a `worker` sdílejí volume `tmpfiles` pro dočasné soubory ručních nahrání.

## Ověření / CI

```bash
# Frontend (root)
npm run lint && npm run typecheck && npm run test:run && npm run build

# Backend
cd backend && npm run lint && npx tsc --noEmit && npm test
```

GitHub Actions (`.github/workflows/ci.yml`): lint, typecheck, testy, build a gitleaks na každý push/PR.

## Stavy dokumentu

| Stav | Význam |
|---|---|
| `processing` | čeká na zpracování / právě se zpracovává |
| `exported` | založeno v ABRA Flexi (s odkazem na doklad) |
| `export_failed` | Abra doklad odmítla — **lze opakovat** z uložených vytěžených dat |
| `extraction_failed` | vytěžení selhalo (soubor už neexistuje, nelze opakovat) |
| `skipped_duplicate` | duplicita (hash nebo již existuje v Abře) |
| `skipped_not_invoice` | dokument není faktura přijatá |

## API (stručně)

Všechny endpointy pod `/api`, autentizace `Authorization: Bearer <JWT>`.

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `GET|POST /companies`, `PATCH|DELETE /companies/:id`
- `PUT /companies/:id/abraflexi`, `POST /companies/:id/abraflexi/test`
- `GET /companies/:id/documents` (stránkování, filtr stavu, fulltext), `GET …/stats`, `GET …/:docId`, `POST …/:docId/retry`
- `POST /companies/:id/documents/upload` — multipart, pole `files` (max 10 × 25 MB)
- `GET|POST /companies/:id/sources/*` — správa zdrojů, test IMAP, ruční poll, výběr složky
- `GET /oauth/:provider/start`, `GET /oauth/:provider/callback`

## Bezpečnost

- Hesla uživatelů: bcrypt (cost 12); JWT HS256, platnost 7 dní
- Uložené přístupy (IMAP, OAuth tokeny, ABRA): AES-256-GCM, klíč mimo DB
- SSRF ochrana u uživatelem zadávaných URL (ABRA Flexi)
- Validace nahrávaných souborů podle magic numbers, limit velikosti
- Rate limiting na auth endpointech, Helmet CSP, vše Zod-validované
