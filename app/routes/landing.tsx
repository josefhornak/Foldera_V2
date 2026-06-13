import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight,
  ArrowUpRight,
  Mail,
  ScanLine,
  CopyCheck,
  FileCheck2,
  Receipt,
  Sparkles,
  Check,
  Paperclip,
  Users,
} from 'lucide-react';
import { Button } from '~/components/ui/Button';
import { api, ApiError } from '~/lib/api';
import { cn } from '~/lib/utils';
import { useAuthStore } from '~/stores/auth';

const SITE_URL = 'https://foldera.cz';
const OG_TITLE = 'Foldera — doklady do ABRA Flexi bez přepisování';
const OG_DESC =
  'Foldera běží bezobslužně: příchozí doklady — faktury, zálohové faktury, dobropisy, účtenky i daňové doklady — sama vytěží a založí do ABRA Flexi i s přílohou. Vy už jen kontrolujete ve svém účetnictví. 7 dní zdarma.';

export function meta() {
  return [
    { title: OG_TITLE },
    { name: 'description', content: OG_DESC },
    { name: 'robots', content: 'index, follow' },
    { name: 'keywords', content: 'doklady, faktury, zálohová faktura, dobropis, účtenka, daňový doklad, ABRA Flexi, FlexiBee, účetnictví, automatizace dokladů, faktura přijatá, ISDOC, OCR' },
    { tagName: 'link', rel: 'canonical', href: `${SITE_URL}/` },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'Foldera' },
    { property: 'og:locale', content: 'cs_CZ' },
    { property: 'og:url', content: `${SITE_URL}/` },
    { property: 'og:title', content: OG_TITLE },
    { property: 'og:description', content: OG_DESC },
    { property: 'og:image', content: `${SITE_URL}/og-image.svg` },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: OG_TITLE },
    { name: 'twitter:description', content: OG_DESC },
    { name: 'twitter:image', content: `${SITE_URL}/og-image.svg` },
    {
      'script:ld+json': {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Foldera',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: `${SITE_URL}/`,
        description: OG_DESC,
        offers: {
          '@type': 'Offer',
          price: '199',
          priceCurrency: 'CZK',
          description: '199 Kč měsíčně za firmu, 100 dokladů v ceně, 7 dní zdarma.',
        },
        publisher: { '@type': 'Organization', name: 'Foldera', url: SITE_URL },
      },
    },
  ];
}

const STEPS = [
  { title: 'Připojíte zdroj dokladů', text: 'Sběrný e-mail, OneDrive nebo Google Drive. Doklady pak stačí přeposlat nebo uložit do složky.' },
  { title: 'Foldera vytěží údaje', text: 'Z každého dokladu přečte dodavatele, IČO, částky, sazby DPH i položky a ověří, jestli už v ABRA Flexi není.' },
  { title: 'Vy už jen zkontrolujete', text: 'Hotový doklad i s přílohou a zaúčtováním na vás čeká v ABRA Flexi. Stačí projít, co přišlo.' },
];

const FEATURES = [
  { icon: Receipt, title: 'Všechny typy dokladů', text: 'Faktury, zálohové faktury, dobropisy a daňové doklady k přijaté platbě do faktur přijatých, účtenky rovnou do pokladny — vše se správným typem dokladu.' },
  { icon: Mail, title: 'Sběrný e-mail i cloud', text: 'Vlastní adresa @inbox.foldera.cz, OneDrive i Google Drive. Foldera je kontroluje každých pár minut.' },
  { icon: ScanLine, title: 'Spolehlivé vytěžení', text: 'Přesné čtení dat, u elektronických dokladů rovnou z ISDOC. Zvládne cizí měny, přenesenou daňovou povinnost i více sazeb DPH.' },
  { icon: CopyCheck, title: 'Kontrola duplicit', text: 'Stejný doklad se nezaloží dvakrát. Porovnáváme podle IČO, čísla i variabilního symbolu.' },
  { icon: Sparkles, title: 'Automatické zaúčtování', text: 'Doplní řádek DPH, předkontaci i řádek kontrolního hlášení — podle historie dodavatele, nebo návrhem od AI.' },
  { icon: Paperclip, title: 'Originál i e-mail v příloze', text: 'Zdrojový doklad přiložíme k záznamu v ABRA. Volitelně k němu uložíme i původní e-mail (.eml) jako důkaz.' },
  { icon: Users, title: 'Více firem a tým', text: 'Pod jedním účtem spravujete více firem. Kolegy pozvete e-mailem jako správce, nebo jen pro nahlížení.' },
];

const FAQ = [
  { q: 'Kam putují moje data?', a: 'Doklady zpracováváme přes pokročilou evropskou AI s OCR — data zůstávají v EU a řídíme se GDPR. Soubory navíc trvale neukládáme: po vytěžení a nahrání do ABRA Flexi se originál smaže.' },
  { q: 'Ukládáte naše soubory?', a: 'Ne. Soubor se jen zpracuje, nahraje jako příloha do ABRA Flexi a poté smaže. V aplikaci zůstanou pouze vytěžená metadata, abyste mohli export případně zopakovat.' },
  { q: 'Funguje to s mojí verzí ABRA Flexi?', a: 'Ano. Připojujeme se přes REST API ABRA Flexi (FlexiBee). Stačí zadat adresu instance, firmu a přihlašovací údaje.' },
  { q: 'Co když se doklad nerozpozná správně?', a: 'Nízká přesnost se označí a doklad lze znovu exportovat z uložených dat. Nepovedený export jde kdykoli zopakovat, nic se neztratí.' },
  { q: 'Platí se za uživatele?', a: 'Ne. Platíte za firmu a počet zpracovaných dokladů, uživatelů můžete mít kolik chcete.' },
];

export default function Landing() {
  const token = useAuthStore((s) => s.token);
  const appHref = token ? '/dashboard' : '/register';
  const loggedIn = Boolean(token);

  return (
    <div className="grain relative min-h-screen bg-[var(--surface-ground)] text-[var(--text-primary)]">
      <div className="relative z-[1]">
        <Nav appHref={appHref} loggedIn={loggedIn} />
        <Hero appHref={appHref} loggedIn={loggedIn} />
        <HowItWorks />
        <Features />
        <Pricing />
        <Faq />
        <Contact />
        <Cta appHref={appHref} loggedIn={loggedIn} />
        <Footer />
      </div>
    </div>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-[9px] text-[15px] font-bold text-white [background:var(--accent-gradient)]',
        className
      )}
      style={{ boxShadow: 'var(--accent-glow)' }}
      aria-hidden="true"
    >
      F
    </span>
  );
}

function Nav({ appHref, loggedIn }: { appHref: string; loggedIn: boolean }) {
  const links = [
    ['Jak to funguje', '#jak'],
    ['Funkce', '#funkce'],
    ['Ceník', '#cenik'],
    ['Kontakt', '#kontakt'],
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--surface-ground)]/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#top" className="flex items-center gap-2.5">
          <BrandMark />
          <span className="font-heading text-[17px] font-bold tracking-tight">Foldera</span>
        </a>
        <div className="hidden items-center gap-8 md:flex">
          {links.map(([label, href]) => (
            <a key={href} href={href} className="kicker ul-grow !text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              {label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {!loggedIn && (
            <Link to="/login" className="hidden text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] sm:block">
              Přihlásit
            </Link>
          )}
          <Link to={appHref}>
            <Button>{loggedIn ? 'Do aplikace' : 'Vyzkoušet zdarma'}</Button>
          </Link>
        </div>
      </nav>
    </header>
  );
}

function Hero({ appHref, loggedIn }: { appHref: string; loggedIn: boolean }) {
  return (
    <section id="top" className="relative mx-auto max-w-6xl px-6 pb-10 pt-16 md:pt-24">
      <div className="kicker flex items-center gap-3 animate-rise">
        <span className="h-px w-8 bg-[var(--brand-primary)]" />
        Doklady → ABRA Flexi · bez přepisování
      </div>
      <h1 className="mt-6 max-w-4xl font-heading text-[2.7rem] font-bold leading-[0.98] tracking-[-0.02em] animate-rise md:text-[4.6rem]">
        Konec přepisování dokladů.
        <br />
        Vy jen kontrolujete v <span className="text-[var(--brand-primary-light)]">ABRA&nbsp;Flexi</span>.
      </h1>
      <div className="mt-8 flex flex-col gap-8 animate-rise md:flex-row md:items-end md:justify-between [animation-delay:80ms]">
        <p className="max-w-lg text-lg leading-relaxed text-[var(--text-secondary)]">
          Faktury, zálohové faktury, dobropisy, účtenky i daňové doklady — vše se do ABRA Flexi založí samo. Vy už jen
          zkontrolujete, co přišlo.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link to={appHref}>
            <Button icon={<ArrowRight />}>{loggedIn ? 'Do aplikace' : 'Vyzkoušet 7 dní zdarma'}</Button>
          </Link>
          <a href="#jak">
            <Button variant="secondary">Jak to funguje</Button>
          </a>
        </div>
      </div>

      <HeroFrame />

      <p className="mt-5 kicker">Bez karty · 7 dní / 10 dokladů zdarma</p>
    </section>
  );
}

/** Clean framed product window — bordered, with a thin accent top rule. */
function HeroFrame() {
  const rows = [
    { sup: 'Dodavatel materiálu s.r.o.', num: '26100412', amt: '18 540', color: 'var(--status-success)', label: 'Zpracováno' },
    { sup: 'Energie a teplo a.s.', num: 'FV-262214', amt: '1 249', color: 'var(--status-success)', label: 'Zpracováno' },
    { sup: 'Velkoobchod CZ s.r.o.', num: '2611008842', amt: '23 118', color: 'var(--status-info)', label: 'Čeká' },
    { sup: 'Telekomunikace s.r.o.', num: 'FV-998120', amt: '849', color: 'var(--status-warning)', label: 'Zpracovává se' },
  ];
  return (
    <div className="mt-14 overflow-hidden rounded-[var(--radius-token-lg)] border border-[var(--border-strong)] bg-[var(--surface-default)] shadow-[var(--shadow-lg)] animate-rise [animation-delay:140ms]">
      <div className="h-[3px] w-full [background:var(--accent-gradient)]" />
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="ml-2 font-mono text-[11px] text-[var(--text-tertiary)]">foldera.cz / dokumenty</span>
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {rows.map((r) => (
          <div key={r.num} className="flex items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{r.sup}</p>
              <p className="truncate font-mono text-[11px] text-[var(--text-tertiary)]">{r.num}</p>
            </div>
            <span className="text-sm font-semibold tabular-nums">{r.amt} Kč</span>
            <span className="hidden w-[140px] items-center justify-end gap-2 text-xs text-[var(--text-secondary)] sm:flex">
              <span className="status-dot" style={{ color: r.color }} />
              {r.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Editorial block: mono kicker + title in a left rail, content on the right. */
function Block({ id, index, kicker, title, intro, children }: {
  id?: string; index: string; kicker: string; title: string; intro?: string; children: ReactNode;
}) {
  return (
    <section id={id} className="border-t border-[var(--border-subtle)]">
      <div className="mx-auto max-w-6xl px-6 py-20 md:grid md:grid-cols-[260px_1fr] md:gap-14 md:py-28">
        <div className="mb-10 md:mb-0">
          <div className="kicker flex items-center gap-3">
            <span className="text-[var(--brand-primary-light)]">{index}</span>
            <span>{kicker}</span>
          </div>
          <h2 className="mt-4 font-heading text-3xl font-bold leading-[1.05] tracking-[-0.01em] md:text-[2.4rem]">{title}</h2>
          {intro && <p className="mt-4 max-w-xs text-sm leading-relaxed text-[var(--text-secondary)]">{intro}</p>}
        </div>
        <div>{children}</div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <Block id="jak" index="01" kicker="Jak to funguje" title="Jen jednou nastavíte" intro="Zdroj dokladů připojíte jednou. Od té chvíle Foldera pracuje sama a vy se k dokladům vrátíte už jen na kontrolu v ABRA Flexi.">
      <div>
        {STEPS.map((s, i) => (
          <div key={s.title} className="flex gap-6 border-t border-[var(--border-subtle)] py-7 first:border-t-0">
            <span className="font-heading text-2xl font-bold tabular-nums text-[var(--text-tertiary)]">0{i + 1}</span>
            <div>
              <h3 className="text-lg font-semibold">{s.title}</h3>
              <p className="mt-1.5 max-w-md text-sm leading-relaxed text-[var(--text-secondary)]">{s.text}</p>
            </div>
          </div>
        ))}
      </div>
    </Block>
  );
}

function Features() {
  return (
    <Block
      id="funkce"
      index="02"
      kicker="Funkce"
      title="Autonomní pracovník"
      intro="Na rozdíl od jiných nástrojů nepracujete v žádné další aplikaci. Všechno máte rovnou ve svém účetnictví."
    >
      <div className="grid border-l border-[var(--border-subtle)] sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="group border-b border-r border-[var(--border-subtle)] p-7 transition-colors hover:bg-white/[0.02]">
            <f.icon className="h-5 w-5 text-[var(--brand-primary-light)] transition-transform group-hover:-translate-y-0.5" />
            <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{f.text}</p>
          </div>
        ))}
      </div>
    </Block>
  );
}

function Pricing() {
  const included = [
    '100 dokladů v ceně každý měsíc',
    'Každý další doklad jen 2 Kč',
    'Neomezeně uživatelů',
    'Sběrný e-mail, OneDrive i Google Drive',
    'Faktury, zálohovky, dobropisy, účtenky i daňové doklady',
    'Automatické zaúčtování (historie / AI)',
  ];
  return (
    <Block id="cenik" index="03" kicker="Ceník" title="Jeden plán, bez závazků" intro="Platíte za firmu, ne za uživatele. Každý měsíc vám přijde běžná faktura.">
      <div className="gradient-border overflow-hidden rounded-[var(--radius-token-xl)] p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-heading text-5xl font-bold tracking-tight">199 Kč</span>
              <span className="text-[var(--text-secondary)]">/ měsíc · firma</span>
            </div>
            <p className="mt-2 text-sm text-[var(--text-tertiary)]">7 dní zdarma (až 10 dokladů), bez karty.</p>
          </div>
          <Link to="/register">
            <Button icon={<ArrowRight />}>Vyzkoušet zdarma</Button>
          </Link>
        </div>
        <ul className="mt-8 grid gap-3 border-t border-[var(--border-subtle)] pt-7 sm:grid-cols-2">
          {included.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-primary-light)]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </Block>
  );
}

function Faq() {
  return (
    <Block index="04" kicker="Časté dotazy" title="Co se nejčastěji ptáte">
      <div className="border-t border-[var(--border-subtle)]">
        {FAQ.map((item) => (
          <details key={item.q} className="group border-b border-[var(--border-subtle)] py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold">
              {item.q}
              <span className="text-xl text-[var(--text-tertiary)] transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]">{item.a}</p>
          </details>
        ))}
      </div>
    </Block>
  );
}

function Contact() {
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', company: '', message: '' });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api('/api/contact', { method: 'POST', body: form });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Odeslání se nezdařilo, zkuste to prosím znovu.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'h-10 w-full border-0 border-b border-[var(--border-default)] bg-transparent px-0 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] transition-colors focus:border-[var(--brand-primary)] focus:outline-none';

  return (
    <Block id="kontakt" index="05" kicker="Kontakt" title="Máte dotaz? Napište nám" intro="Ozveme se obvykle do jednoho pracovního dne.">
      <div className="max-w-xl">
        {sent ? (
          <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] py-10">
            <Check className="h-6 w-6 text-[var(--brand-primary-light)]" />
            <p className="text-sm">Děkujeme, zpráva odešla — brzy se vám ozveme.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <input required placeholder="Jméno" className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input required type="email" placeholder="E-mail" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <input placeholder="Firma (nepovinné)" className={inputClass} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            <textarea required placeholder="Vaše zpráva" rows={3} className={cn(inputClass, 'h-auto resize-none py-2')} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            {error && <p className="text-xs text-[var(--status-error-text)]">{error}</p>}
            <Button type="submit" loading={submitting}>Odeslat zprávu</Button>
          </form>
        )}
      </div>
    </Block>
  );
}

function Cta({ appHref, loggedIn }: { appHref: string; loggedIn: boolean }) {
  return (
    <section className="border-t border-[var(--border-subtle)]">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-6 py-24 md:flex-row md:items-end md:justify-between">
        <h2 className="max-w-2xl font-heading text-4xl font-bold leading-[1.02] tracking-[-0.02em] md:text-6xl">
          Začněte za<br /> <span className="text-[var(--brand-primary-light)]">dvě minuty.</span>
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Link to={appHref}>
            <Button icon={<ArrowUpRight />}>{loggedIn ? 'Do aplikace' : 'Vyzkoušet 7 dní zdarma'}</Button>
          </Link>
          <a href="#cenik">
            <Button variant="secondary">Ceník</Button>
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--border-subtle)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 text-sm text-[var(--text-tertiary)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7 rounded-[8px] text-[13px]" />
          <span className="font-heading font-bold text-[var(--text-secondary)]">Foldera</span>
          <span className="kicker ml-2 hidden sm:block">© 2026 · doklady do ABRA Flexi</span>
        </div>
        <div className="flex items-center gap-6">
          <Link to="/podminky" className="ul-grow hover:text-[var(--text-primary)]">Obchodní podmínky</Link>
          <Link to="/login" className="ul-grow hover:text-[var(--text-primary)]">Přihlásit</Link>
          <a href="#cenik" className="ul-grow hover:text-[var(--text-primary)]">Ceník</a>
        </div>
      </div>
    </footer>
  );
}
