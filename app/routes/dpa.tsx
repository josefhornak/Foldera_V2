import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { LogoMark } from '~/components/ui/Logo';
import { cn } from '~/lib/utils';

const SITE_URL = 'https://foldera.cz';

export function meta() {
  return [
    { title: 'Zpracování osobních údajů - Foldera' },
    { name: 'description', content: 'Podmínky zpracování osobních údajů (zpracovatelská smlouva dle čl. 28 GDPR) pro službu Foldera, včetně seznamu subdodavatelů.' },
    { name: 'robots', content: 'index, follow' },
    { tagName: 'link', rel: 'canonical', href: `${SITE_URL}/zpracovani-udaju` },
  ];
}

const UPDATED = '15. 7. 2026';

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 font-heading text-xl font-bold tracking-tight">{children}</h2>;
}
function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('mt-3 text-sm leading-relaxed text-[var(--text-secondary)]', className)}>{children}</p>;
}
function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="text-[var(--text-primary)]">{children}</strong>;
}
function Li({ children }: { children: React.ReactNode }) {
  return <li className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{children}</li>;
}

export default function Dpa() {
  return (
    <div className="min-h-screen bg-[var(--surface-ground)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--surface-ground)]/70 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <LogoMark className="h-9 w-9" />
            <span className="font-heading text-lg font-bold tracking-tight">Foldera</span>
          </Link>
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <ArrowLeft className="h-4 w-4" /> Zpět
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-14">
        <h1 className="font-heading text-3xl font-bold tracking-tight md:text-4xl">Podmínky zpracování osobních údajů</h1>
        <p className="mt-3 text-sm text-[var(--text-tertiary)]">Zpracovatelská smlouva dle čl. 28 GDPR · účinné od {UPDATED}</p>

        <P>
          Tyto podmínky tvoří nedílnou součást smlouvy o užívání služby Foldera a upravují zpracování osobních údajů,
          které do služby vkládáte (zejména údaje obsažené v dokladech). Při tomto zpracování vystupuje{' '}
          <Strong>zákazník jako správce</Strong> a poskytovatel služby (Ing. Josef Horňák, IČO 19910916) jako{' '}
          <Strong>zpracovatel</Strong>. Zpracování údajů, u nichž je poskytovatel sám správcem (např. údaje o účtu),
          popisují <Link to="/ochrana-udaju" className="text-[var(--text-link)] underline underline-offset-2">zásady ochrany osobních údajů</Link>.
        </P>

        <H2>1. Předmět, doba a účel zpracování</H2>
        <P>
          Předmětem je zpracování osobních údajů obsažených v dokladech zákazníka za účelem jejich automatického vytěžení
          a založení odpovídajícího dokladu do účetního systému zákazníka (ABRA Flexi), včetně přílohy. Zpracování probíhá
          po dobu trvání smlouvy a v rozsahu nezbytném k poskytování služby.
        </P>

        <H2>2. Povaha zpracování, kategorie subjektů a údajů</H2>
        <P>
          Zpracování zahrnuje příjem souboru, automatické vytěžení údajů (OCR), kontrolu duplicit a zápis do účetního
          systému zákazníka. Subjekty údajů jsou zejména <Strong>dodavatelé a odběratelé zákazníka a osoby uvedené na
          dokladech</Strong>. Kategorie údajů zahrnují identifikační a fakturační údaje (jméno, IČO/DIČ, adresa,
          čísla dokladů, částky) a kontaktní údaje uvedené na dokladu.
        </P>

        <H2>3. Povinnosti zpracovatele</H2>
        <ul className="mt-3 list-disc pl-5 marker:text-[var(--text-tertiary)]">
          <Li>zpracovávat osobní údaje pouze na základě doložitelných pokynů správce a k výše uvedenému účelu;</Li>
          <Li>zavázat osoby oprávněné zpracovávat údaje mlčenlivostí;</Li>
          <Li>přijmout vhodná technická a organizační opatření dle čl. 32 GDPR (viz čl. 5);</Li>
          <Li>být správci nápomocen při plnění jeho povinností (práva subjektů, ohlašování incidentů, posouzení vlivu);</Li>
          <Li>po skončení poskytování služby osobní údaje vymazat nebo vrátit, nevyžaduje-li jejich uchování právo EU či ČR;</Li>
          <Li>poskytnout správci informace nezbytné k doložení plnění těchto povinností a umožnit audit.</Li>
        </ul>

        <H2>4. Zapojení dalších zpracovatelů (subdodavatelů)</H2>
        <P>
          Správce uděluje zpracovateli obecné povolení zapojit další zpracovatele. Zpracovatel je zavazuje stejnými
          povinnostmi v oblasti ochrany údajů. Aktuální seznam:
        </P>
        <div className="mt-4 overflow-hidden rounded-[var(--radius-token-lg)] border border-[var(--border-subtle)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--surface-raised)] text-left text-[var(--text-tertiary)]">
                <th className="px-4 py-2.5 font-medium">Subdodavatel</th>
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
          O zamýšlené změně subdodavatelů zpracovatel správce předem informuje (aktualizací tohoto seznamu) a správce má
          právo proti změně vznést námitku.
        </P>

        <H2>5. Zabezpečení</H2>
        <P>
          Zpracovatel uplatňuje zejména: šifrované uložení přístupových údajů (k ABRA Flexi a e-mailovým schránkám),
          šifrovaný přenos (TLS), řízení přístupu, oddělení dat jednotlivých zákazníků a zásadu{' '}
          <Strong>minimalizace uchovávání originálních souborů</Strong> dokladů - viz čl. 6.
        </P>

        <H2>6. Uchovávání originálních souborů dokladů</H2>
        <P>
          Originální soubor dokladu zpracovatel uchovává pouze po dobu, po kterou je potřebný k poskytování služby:
        </P>
        <ul className="mt-3 list-disc pl-5 marker:text-[var(--text-tertiary)]">
          <Li>
            u dokladů, které byly úspěšně zpracovány (založeny do účetnictví správce, nebo přeskočeny), nejdéle{' '}
            <Strong>24 hodin</Strong> od zpracování;
          </Li>
          <Li>
            u dokladů, které skončily chybou nebo čekají na schválení správcem, do doby, než je správce úspěšně odešle
            do účetnictví nebo je smaže - originál je nezbytný k tomu, aby správce mohl chybu posoudit a údaje opravit;
          </Li>
          <Li>smaže-li správce doklad ve službě, zpracovatel originální soubor smaže neprodleně.</Li>
        </ul>
        <P>
          Po uplynutí těchto lhůt zůstávají v aplikaci pouze vytěžená metadata nezbytná pro provoz. Originální soubory
          jsou po celou dobu uloženy výhradně na serverech v EU (viz čl. 7).
        </P>

        <H2>7. Předání do třetích zemí</H2>
        <P>
          Vytěžení i hosting probíhají v EU. Odesílání e-mailů přes službu Resend (USA) může zahrnovat přenos údajů
          nezbytných pro doručení; tento přenos je ošetřen nástrojem dle čl. 46 GDPR (standardní smluvní doložky,
          případně EU–US Data Privacy Framework).
        </P>

        <H2>8. Porušení zabezpečení</H2>
        <P>
          Zjistí-li zpracovatel porušení zabezpečení osobních údajů, ohlásí je správci bez zbytečného odkladu a poskytne
          součinnost potřebnou k případnému splnění ohlašovacích povinností správce.
        </P>

        <H2>9. Po skončení smlouvy</H2>
        <P>
          Po ukončení poskytování služby zpracovatel osobní údaje vymaže (případně vrátí), nevyžadují-li právní předpisy
          jejich další uchování.
        </P>

        <div className="mt-12 border-t border-[var(--border-subtle)] pt-6 text-sm text-[var(--text-tertiary)]">
          <Link to="/" className="text-[var(--text-link)] underline underline-offset-2">Zpět na úvod</Link>
          <span className="px-2">·</span>
          <Link to="/ochrana-udaju" className="text-[var(--text-link)] underline underline-offset-2">Ochrana osobních údajů</Link>
          <span className="px-2">·</span>
          <Link to="/podminky" className="text-[var(--text-link)] underline underline-offset-2">Obchodní podmínky</Link>
        </div>
      </main>
    </div>
  );
}
