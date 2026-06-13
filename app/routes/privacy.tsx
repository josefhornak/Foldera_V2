import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { cn } from '~/lib/utils';

const SITE_URL = 'https://foldera.cz';

export function meta() {
  return [
    { title: 'Ochrana osobních údajů — Foldera' },
    { name: 'description', content: 'Zásady ochrany osobních údajů služby Foldera — jaké údaje zpracováváme, proč, komu je předáváme a jaká máte práva.' },
    { name: 'robots', content: 'index, follow' },
    { tagName: 'link', rel: 'canonical', href: `${SITE_URL}/ochrana-udaju` },
  ];
}

const UPDATED = '13. 6. 2026';

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 font-heading text-xl font-bold tracking-tight">{children}</h2>;
}
function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('mt-3 text-sm leading-relaxed text-[var(--text-secondary)]', className)}>{children}</p>;
}
function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="text-[var(--text-primary)]">{children}</strong>;
}

export default function Privacy() {
  return (
    <div className="min-h-screen bg-[var(--surface-ground)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--surface-ground)]/70 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-[11px] text-[17px] font-bold text-white [background:var(--accent-gradient)]"
              style={{ boxShadow: 'var(--accent-glow)' }}
              aria-hidden="true"
            >
              F
            </span>
            <span className="font-heading text-lg font-bold tracking-tight">Foldera</span>
          </Link>
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <ArrowLeft className="h-4 w-4" /> Zpět
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-14">
        <h1 className="font-heading text-3xl font-bold tracking-tight md:text-4xl">Zásady ochrany osobních údajů</h1>
        <p className="mt-3 text-sm text-[var(--text-tertiary)]">Účinné od {UPDATED}</p>

        <P>
          Tyto zásady popisují, jak služba Foldera zpracovává osobní údaje v souladu s nařízením (EU) 2016/679 (GDPR).
          Týkají se údajů, které zpracováváme jako <Strong>správce</Strong> (např. údaje o vašem účtu). Údaje obsažené
          v dokladech, které do služby vkládáte, zpracováváme jako <Strong>zpracovatel</Strong> jménem vaší firmy —
          tomu se věnují samostatné{' '}
          <Link to="/zpracovani-udaju" className="text-[var(--text-link)] underline underline-offset-2">podmínky zpracování osobních údajů</Link>.
        </P>

        <H2>1. Správce</H2>
        <P>
          Správcem je <Strong>Ing. Josef Horňák</Strong>, IČO 19910916, se sídlem Topolová 4411, 276 01 Mělník,
          zapsaný v živnostenském rejstříku, neplátce DPH. Kontakt:{' '}
          <a className="text-[var(--text-link)] underline underline-offset-2" href="mailto:josef.hornak@foldera.cz">josef.hornak@foldera.cz</a>.
          Nejmenovali jsme pověřence pro ochranu osobních údajů, není to naší zákonnou povinností.
        </P>

        <H2>2. Jaké údaje zpracováváme a na jakém základě</H2>
        <P>
          <Strong>Údaje účtu</Strong> (jméno, e-mailová adresa, zaheslovaná podoba hesla) a <Strong>údaje o firmě</Strong>
          {' '}(název, IČO, sídlo, fakturační e-mail) — právním základem je <Strong>plnění smlouvy</Strong> (poskytování
          služby) a u fakturačních a účetních údajů též <Strong>plnění právní povinnosti</Strong> (vedení účetnictví).
        </P>
        <P>
          <Strong>Provozní a technické údaje</Strong> (IP adresa, časy přístupů, technické logy, údaje nezbytné pro
          přihlášení) — na základě <Strong>oprávněného zájmu</Strong> na bezpečném a spolehlivém provozu služby.
        </P>
        <P>
          <Strong>Obsah dokladů</Strong> (faktury, účtenky a další doklady, které do služby vložíte) — ty zpracováváme
          jménem vaší firmy jako zpracovatel. Originální soubory po vytěžení a nahrání do vašeho účetnictví
          <Strong> trvale neukládáme</Strong>; v aplikaci zůstávají jen vytěžená metadata nezbytná pro provoz a případné
          zopakování exportu.
        </P>

        <H2>3. Komu údaje předáváme</H2>
        <P>
          Údaje nepředáváme nikomu k jejich vlastním účelům. Využíváme však pečlivě vybrané poskytovatele, kteří
          zpracovávají údaje pro nás (zpracovatelé / subdodavatelé):
        </P>
        <div className="mt-4 overflow-hidden rounded-[var(--radius-token-lg)] border border-[var(--border-subtle)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--surface-raised)] text-left text-[var(--text-tertiary)]">
                <th className="px-4 py-2.5 font-medium">Poskytovatel</th>
                <th className="px-4 py-2.5 font-medium">Účel</th>
                <th className="px-4 py-2.5 font-medium">Umístění</th>
              </tr>
            </thead>
            <tbody className="text-[var(--text-secondary)]">
              <tr className="border-t border-[var(--border-subtle)]">
                <td className="px-4 py-2.5">Hetzner Online GmbH</td>
                <td className="px-4 py-2.5">Hosting serverů a databáze</td>
                <td className="px-4 py-2.5">Německo (EU)</td>
              </tr>
              <tr className="border-t border-[var(--border-subtle)]">
                <td className="px-4 py-2.5">Mistral AI</td>
                <td className="px-4 py-2.5">Vytěžení (OCR) údajů z dokladů</td>
                <td className="px-4 py-2.5">Francie (EU)</td>
              </tr>
              <tr className="border-t border-[var(--border-subtle)]">
                <td className="px-4 py-2.5">Resend (Resend, Inc.)</td>
                <td className="px-4 py-2.5">Odesílání transakčních e-mailů</td>
                <td className="px-4 py-2.5">USA</td>
              </tr>
            </tbody>
          </table>
        </div>
        <P>
          Vaše účetní data dále zapisujeme do <Strong>ABRA Flexi</Strong> — to je ale systém, který si volíte a provozujete
          vy; nevystupuje jako náš subdodavatel, jen jako cíl, kam doklady na váš pokyn zakládáme.
        </P>

        <H2>4. Předání mimo EU</H2>
        <P>
          Vytěžení dokladů i hosting probíhají v rámci EU. Výjimkou je odesílání e-mailů přes službu Resend (USA), kam se
          dostávají údaje nezbytné pro doručení zprávy (e-mailová adresa, předmět a obsah, např. údaje z faktury). Tento
          přenos do třetí země je ošetřen odpovídajícím nástrojem dle čl. 46 GDPR (standardní smluvní doložky, případně
          mechanismus EU–US Data Privacy Framework).
        </P>

        <H2>5. Jak dlouho údaje uchováváme</H2>
        <P>
          Údaje účtu zpracováváme po dobu trvání účtu. Fakturační a účetní doklady uchováváme po dobu stanovenou právními
          předpisy (zejména zákonem o účetnictví, až 10 let). Originální soubory dokladů neukládáme — mažou se ihned po
          zpracování. Po zrušení účtu osobní údaje, které nemusíme uchovávat ze zákona, vymažeme.
        </P>

        <H2>6. Vaše práva</H2>
        <P>
          Máte právo na přístup ke svým údajům, jejich opravu nebo výmaz, omezení zpracování, přenositelnost a právo
          vznést námitku proti zpracování založenému na oprávněném zájmu. Žádost zašlete na uvedený kontaktní e-mail.
          Máte rovněž právo podat stížnost u dozorového úřadu — <Strong>Úřad pro ochranu osobních údajů</Strong>,
          Pplk. Sochora 27, 170 00 Praha 7 (<a className="text-[var(--text-link)] underline underline-offset-2" href="https://www.uoou.cz" target="_blank" rel="noreferrer">uoou.cz</a>).
        </P>

        <H2>7. Cookies a místní úložiště</H2>
        <P>
          Foldera používá pouze <Strong>nezbytné</Strong> cookies a místní úložiště prohlížeče potřebné pro provoz a
          přihlášení. Nenasazujeme marketingové ani sledovací cookies a nepředáváme údaje reklamním sítím.
        </P>

        <H2>8. Změny</H2>
        <P>
          Tyto zásady můžeme přiměřeně aktualizovat; aktuální znění je vždy dostupné na této stránce s uvedením data
          účinnosti.
        </P>

        <div className="mt-12 border-t border-[var(--border-subtle)] pt-6 text-sm text-[var(--text-tertiary)]">
          <Link to="/" className="text-[var(--text-link)] underline underline-offset-2">Zpět na úvod</Link>
          <span className="px-2">·</span>
          <Link to="/podminky" className="text-[var(--text-link)] underline underline-offset-2">Obchodní podmínky</Link>
          <span className="px-2">·</span>
          <Link to="/zpracovani-udaju" className="text-[var(--text-link)] underline underline-offset-2">Zpracování osobních údajů</Link>
        </div>
      </main>
    </div>
  );
}
