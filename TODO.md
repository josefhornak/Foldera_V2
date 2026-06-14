# Foldera V2 — TODO

Stav k 13. 6. 2026. Seřazeno podle priority. 🔧 = akce mimo repo (DNS, konzole
poskytovatele, založení účtu). U každé položky je konkrétní návod „kde co udělat".

---

## 🔴 Před spuštěním na platící zákazníky

### 1. SPF pro Resend 🔧 DNS
Odchozí e-maily teď padají na SPF (faktury/upozornění → spam). Aktuální TXT
`v=spf1 ip4:46.224.168.141 a mx -all` neobsahuje Resend (posílá přes Amazon SES).
**Kde:** regzone.cz → správa domény `foldera.cz` → DNS záznamy → najít TXT `@`
se začátkem `v=spf1` → upravit na:
```
v=spf1 ip4:46.224.168.141 a mx include:amazonses.com -all
```
**Ověření (po ~hodině):** `dig +short TXT foldera.cz` musí ukázat `include:amazonses.com`.
Pozn.: DKIM už Resend podepisuje, takže tohle dorovná i SPF/DMARC.

### 2. Hetzner AVV 🔧 konzole
**Kde:** Hetzner konzole (Cloud / Robot, kde běží server) → Účet/Settings →
„Order processing" / „Auftragsdatenverarbeitung (AVV/DPA)" → odsouhlasit.
Jeden klik, ne podpis. Bez toho není formálně uzavřená zpracovatelská smlouva
s hostingem.

### 3. Resend DPA / přenos do USA 🔧 konzole
**Kde:** resend.com → dashboard → Settings → Legal/DPA → potvrdit/aktivovat DPA
a ověřit, že kryjí EU→US přenos (DPF certifikace nebo SCC). Pokud nechceš US
přenos vůbec → zvážit EU e-mail providera (viz pozn. níže) a pak upravit zásady.

### 4. Právní revize
Nechat právníka projít `/podminky`, `/ochrana-udaju`, `/zpracovani-udaju`.
Texty jsou připravené, jde o kontrolu na reálný provoz a doplnění případných
specifik (např. konkrétní DPF/SCC formulace u Resend).

### 5. Offsite zálohy + test obnovy 🔧 cíl/účet
Denní `pg_dump` běží (`scripts/backup-db.sh`, cron `/etc/cron.d/foldera-v2-backup`
v 03:30, retence 14 dní), ale leží na stejném disku jako DB.
**Co dodělat:**
- Cíl mimo server (Hetzner Storage Box / S3 / jiný stroj). Pak do skriptu přidat
  upload (rclone/aws s3 cp) — řekni a doplním.
- Jednou ověřit reálné obnovení: `gunzip -c <dump>.sql.gz | docker exec -i foldera-v2-postgres psql -U foldera -d foldera_v2` do **testovací** DB.
- Pozn.: cron je na hostu, ne v repu — při přestavbě serveru znovu nainstalovat
  `/etc/cron.d/foldera-v2-backup`.

---

## 🟠 Funkce

### 6. OneDrive + Google Drive — HOTOVO (self-service)
Uživatel si zadá **vlastní OAuth aplikaci** přímo v aplikaci (Nastavení → Zdroje)
podle návodu na stránce — žádná centrální OAuth aplikace ani env proměnné.
Zbývá jen jednou **otestovat živé připojení** s reálnou Google/Azure aplikací
(zadat creds → Připojit účet → vybrat složku → ověřit, že se doklady stáhnou).

### 8. Návštěvnostní analytika
**Doporučeno: cookieless EU** (Plausible / Simple Analytics) — bez souhlasu, bez
cookie bannerové komplikace, data v EU.
**Kde:** plausible.io → přidat web `foldera.cz` → zkopírovat `<script>` snippet →
vložit do `app/root.tsx` (do `<head>`). Pak přidat Plausible do zásad ochrany OÚ
+ DPA jako subdodavatele.
⚠️ **Pokud místo toho Google Analytics:** musí se (1) načítat až po opt-in souhlasu
(reálné gatování v `CookieConsent.tsx`), (2) doplnit do zásad ochrany OÚ a DPA,
(3) upravit text cookie lišty. Jinak to koliduje s tvrzením „žádné sledovací cookies".

---

## 🟡 Provoz a zpevnění

### 9. Uptime monitoring 🔧 účet
**Kde:** uptimerobot.com (zdarma) → Add monitor → HTTP(s) →
`https://flexi.foldera.cz/api/health` → interval 5 min → alert na e-mail/SMS.

### 10. Error tracking 🔧 účet
**Kde:** sentry.io → nový projekt (Node) → zkopírovat DSN → `npm i @sentry/node`
v backendu, inicializovat v `src/index.ts` i `src/worker.ts`, DSN do `backend/.env`.
Řekni a zapojím to.

### 11. Bezpečnostní backlog (z auditu 06/2026)
- Rotace secretů: `backend/.env` (SMTP/Mistral klíče, `APP_ENCRYPTION_KEY`, `JWT_SECRET`)
  + `POSTGRES_PASSWORD` v root `.env`.
- Kontejnery pod ne-root uživatelem (Dockerfile `USER`).
- Revokace/blacklist JWT (odhlášení = zneplatnění tokenu).
- CSP hlavičky (Content-Security-Policy) — pozor, testovat, ať nerozbije SPA.

### 12. www.foldera.cz certifikát 🔧 DNS
**Kde:** regzone.cz → přidat A záznam `www` → `46.224.168.141` (nebo CNAME na
`foldera.cz`). Pak na serveru přegenerovat cert s `-d www.foldera.cz` (webroot,
viz topologie serveru). Teď `www` nemá DNS, takže certbot ho neověří.

---

## ✅ Hotovo (reference)

- Faktury do ABRA Flexi: faktury, zálohové, DDPP, dobropisy, účtenky; QR platba,
  ISDOC vložený v PDF; světlý moderní layout; „Faktura" (neplátce DPH).
- Vytěžování položek: volba **kompletní položky vs souhrnně po sazbách DPH**
  (nastavení firmy).
- OneDrive + Google Drive: **vlastní OAuth aplikace zákazníka** s návodem na
  stránce (Nastavení → Zdroje), client secret šifrovaný v DB.
- Průvodce nastavením po registraci (`/vitejte`) + připomínka na dashboardu.
- Týmy/role, více firem, pozvánky e-mailem.
- Fakturace: 199 Kč / 100 dokladů, anniversary billing.
- Trial: viditelný odpočet v aplikaci + e-mail při konci s potvrzením aktivace.
- E-mailové notifikace správcům při chybě zpracování / exportu dokladu.
- GDPR: zásady ochrany OÚ, zpracovatelská smlouva (čl. 28), seznam subdodavatelů
  (Hetzner DE, Mistral FR, Resend US), poctivá cookie lišta.
- SEO: prerendered veřejné stránky, sitemap.xml + robots.txt (vč. právních stránek).
- Branding: jednotné fialové „F" (favicon, PWA ikony, OG, aplikace).
- Provoz: denní zálohy DB (retence 14 dní), worker concurrency 6/4 (laditelné přes
  env), rate-limiting, brute-force cap, healthcheck `/api/health`.
