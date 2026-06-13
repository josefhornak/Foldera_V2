import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight,
  Mail,
  ScanLine,
  CopyCheck,
  FileCheck2,
  Receipt,
  ShieldCheck,
  Sparkles,
  Check,
  Clock,
  Gauge,
  Zap,
  Building2,
} from 'lucide-react';
import { Button } from '~/components/ui/Button';
import { api, ApiError } from '~/lib/api';
import { cn } from '~/lib/utils';
import { useAuthStore } from '~/stores/auth';

const SITE_URL = 'https://foldera.cz';
const OG_TITLE = 'Foldera — faktury do ABRA Flexi bez přepisování';
const OG_DESC =
  'Foldera běží bezobslužně: příchozí faktury, dobropisy i účtenky sama vytěží a založí jako hotový doklad v ABRA Flexi i s přílohou. Vy už jen kontrolujete ve svém účetnictví. 7 dní zdarma.';

export function meta() {
  return [
    { title: OG_TITLE },
    { name: 'description', content: OG_DESC },
    { name: 'robots', content: 'index, follow' },
    { name: 'keywords', content: 'faktury, ABRA Flexi, FlexiBee, účetnictví, automatizace faktur, faktura přijatá, ISDOC, OCR' },
    { tagName: 'link', rel: 'canonical', href: `${SITE_URL}/` },
    // Open Graph
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'Foldera' },
    { property: 'og:locale', content: 'cs_CZ' },
    { property: 'og:url', content: `${SITE_URL}/` },
    { property: 'og:title', content: OG_TITLE },
    { property: 'og:description', content: OG_DESC },
    { property: 'og:image', content: `${SITE_URL}/og-image.svg` },
    // Twitter
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: OG_TITLE },
    { name: 'twitter:description', content: OG_DESC },
    { name: 'twitter:image', content: `${SITE_URL}/og-image.svg` },
    // Structured data
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
          price: '99',
          priceCurrency: 'CZK',
          description: '99 Kč měsíčně za firmu, 50 dokladů v ceně, 7 dní zdarma.',
        },
        publisher: { '@type': 'Organization', name: 'Foldera', url: SITE_URL },
      },
    },
  ];
}

const STEPS = [
  {
    icon: Mail,
    title: 'Připojíte zdroj',
    text: 'Sběrný e-mail, OneDrive nebo Google Drive. Faktury jen přeposíláte nebo ukládáte do složky.',
  },
  {
    icon: ScanLine,
    title: 'Foldera vytěží data',
    text: 'OCR + ISDOC: dodavatel, IČO, částky, sazby DPH, položky. Zkontroluje duplicity.',
  },
  {
    icon: FileCheck2,
    title: 'Vy jen zkontrolujete',
    text: 'Hotový doklad i s přílohou a zaúčtováním čeká v ABRA Flexi. Vaše jediná práce je projít, co dorazilo.',
  },
];

const FEATURES = [
  { icon: Mail, title: 'Sběrný e-mail i cloud', text: 'Vlastní adresa @inbox.foldera.cz, OneDrive a Google Drive. Kontrola každých pár minut.' },
  { icon: ScanLine, title: 'Přesné vytěžení', text: 'Pokročilé OCR + ISDOC jako jistota. Cizí měny, přenesená daňová povinnost, více sazeb DPH.' },
  { icon: CopyCheck, title: 'Kontrola duplicit', text: 'Stejná faktura se nezaloží dvakrát — porovnání podle IČO a čísla / variabilního symbolu.' },
  { icon: Receipt, title: 'Faktury, dobropisy i účtenky', text: 'Faktury a dobropisy do faktur přijatých, účtenky rovnou do pokladny — vše s přílohou.' },
  { icon: Sparkles, title: 'Automatické zaúčtování', text: 'Řádek DPH, předkontace a řádek kontrolního hlášení podle historie dodavatele, nebo návrh od AI.' },
  { icon: ShieldCheck, title: 'Soubory neukládáme', text: 'Originál se zpracuje, nahraje do ABRA a smaže. V aplikaci zůstává jen metadata.' },
];

const STATS = [
  { icon: Clock, value: '< 60 s', label: 'od přijetí faktury po doklad v ABRA' },
  { icon: Gauge, value: '98 %', label: 'přesnost vytěžení u běžných faktur' },
  { icon: Zap, value: '0', label: 'ručního přepisování údajů' },
  { icon: Building2, value: '3', label: 'zdroje příjmu — e-mail, OneDrive, Drive' },
];

const FAQ = [
  {
    q: 'Ukládáte naše soubory?',
    a: 'Ne. Soubor se jen zpracuje, nahraje jako příloha do ABRA Flexi a poté smaže. V aplikaci zůstanou pouze vytěžená metadata, abyste mohli export případně zopakovat.',
  },
  {
    q: 'Funguje to s mojí verzí ABRA Flexi?',
    a: 'Ano. Připojujeme se přes REST API ABRA Flexi (FlexiBee). Stačí zadat adresu instance, firmu a přihlašovací údaje.',
  },
  {
    q: 'Co když se faktura nerozpozná správně?',
    a: 'Nízká přesnost se označí a doklad lze znovu exportovat z uložených dat. ABRA odmítnutí jsou retryovatelná, nic se neztratí.',
  },
  {
    q: 'Platí se za uživatele?',
    a: 'Ne. Platíte za firmu a počet zpracovaných dokladů, uživatelů můžete mít kolik chcete.',
  },
];

export default function Landing() {
  const token = useAuthStore((s) => s.token);
  const appHref = token ? '/dashboard' : '/register';

  return (
    <div className="min-h-screen bg-[var(--surface-ground)] text-[var(--text-primary)]">
      <LandingNav appHref={appHref} loggedIn={Boolean(token)} />
      <Hero appHref={appHref} loggedIn={Boolean(token)} />
      <StatBand />
      <HowItWorks />
      <Features />
      <Pricing />
      <Faq />
      <Contact />
      <CtaBand appHref={appHref} loggedIn={Boolean(token)} />
      <Footer />
    </div>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-[11px] text-[17px] font-bold text-white [background:var(--accent-gradient)]',
        className
      )}
      style={{ boxShadow: 'var(--accent-glow)' }}
      aria-hidden="true"
    >
      F
    </span>
  );
}

function LandingNav({ appHref, loggedIn }: { appHref: string; loggedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--surface-ground)]/70 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2.5">
          <BrandMark />
          <span className="font-heading text-lg font-bold tracking-tight">Foldera</span>
        </a>
        <div className="hidden items-center gap-7 text-sm text-[var(--text-secondary)] md:flex">
          <a href="#jak" className="transition-colors hover:text-[var(--text-primary)]">Jak to funguje</a>
          <a href="#funkce" className="transition-colors hover:text-[var(--text-primary)]">Funkce</a>
          <a href="#cenik" className="transition-colors hover:text-[var(--text-primary)]">Ceník</a>
          <a href="#kontakt" className="transition-colors hover:text-[var(--text-primary)]">Kontakt</a>
        </div>
        <div className="flex items-center gap-2">
          {!loggedIn && (
            <Link to="/login" className="hidden text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] sm:block">
              Přihlásit se
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
    <section id="top" className="relative overflow-hidden">
      <div aria-hidden="true" className="mesh-bg" />
      <div aria-hidden="true" className="grid-overlay" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 md:grid-cols-[1.05fr_0.95fr] md:py-28">
        <div className="animate-rise">
          <h1 className="font-heading text-[2.6rem] font-bold leading-[1.05] tracking-tight md:text-[3.5rem]">
            Konec přepisování faktur.
            <br className="hidden sm:block" /> Vy už jen kontrolujete v{' '}
            <span className="text-gradient">ABRA Flexi</span>.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-[var(--text-secondary)]">
            Foldera běží bezobslužně: každou příchozí fakturu, dobropis i účtenku sama vytěží,
            zkontroluje duplicity a založí jako hotový doklad v ABRA Flexi — i s přílohou.
            Vaše jediná práce je zkontrolovat ve svém účetnictví, co dorazilo.
          </p>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-[var(--text-tertiary)]">
            Na rozdíl od jiných řešení nepřepisujete nic v žádném dalším systému — pracujete
            už jen ve svém ERP.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to={appHref}>
              <Button icon={<ArrowRight />}>{loggedIn ? 'Do aplikace' : 'Vyzkoušet 7 dní zdarma'}</Button>
            </Link>
            <a href="#jak">
              <Button variant="secondary">Jak to funguje</Button>
            </a>
          </div>
          <p className="mt-4 text-xs text-[var(--text-tertiary)]">Bez platební karty · 7 dní / 10 dokladů zdarma</p>
        </div>
        <HeroMock />
      </div>
    </section>
  );
}

/** Glass product mock of the documents table with floating accent cards. */
function HeroMock() {
  const rows = [
    { sup: 'Alza.cz a.s.', num: '26100412', amt: '18 540 Kč', color: 'var(--status-success)', label: 'Zpracováno' },
    { sup: 'ČEZ Prodej, a.s.', num: 'FV-262214', amt: '1 249 Kč', color: 'var(--status-success)', label: 'Zpracováno' },
    { sup: 'MAKRO ČR s.r.o.', num: '2611008842', amt: '23 118 Kč', color: 'var(--status-info)', label: 'Čeká' },
    { sup: 'O2 Czech Republic', num: 'FV-998120', amt: '849 Kč', color: 'var(--status-warning)', label: 'Zpracovává se' },
  ];
  return (
    <div className="relative animate-rise [animation-delay:120ms]">
      {/* glow behind the mock */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-6 rounded-[var(--radius-token-xl)] opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, rgba(139,92,246,0.35), transparent)' }}
      />
      <div className="glass relative rounded-[var(--radius-token-xl)] p-2">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--status-error)]/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--status-warning)]/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--status-success)]/60" />
          <span className="ml-2 text-xs text-[var(--text-tertiary)]">foldera.cz · Dokumenty</span>
        </div>
        <div className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-token-lg)] bg-[var(--surface-sunken)]/80">
          {rows.map((r) => (
            <div key={r.num} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">{r.sup}</p>
                <p className="truncate text-xs text-[var(--text-tertiary)]">{r.num}</p>
              </div>
              <span className="text-[13px] font-semibold tabular-nums">{r.amt}</span>
              <span className="inline-flex w-[120px] items-center justify-end gap-2 text-xs text-[var(--text-secondary)]">
                <span className="status-dot" style={{ color: r.color }} />
                {r.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* floating accuracy card (echoes the reference's stat tile) */}
      <div className="glass animate-float absolute -bottom-6 -left-6 hidden rounded-[var(--radius-token-lg)] px-4 py-3 sm:block">
        <p className="text-[11px] font-medium text-[var(--text-tertiary)]">Přesnost vytěžení</p>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span className="font-heading text-2xl font-bold text-gradient">98</span>
          <span className="text-xs text-[var(--text-tertiary)]">/ 100</span>
        </div>
      </div>

      {/* floating ISDOC pill */}
      <div className="glass animate-float-slow absolute -right-4 -top-4 hidden items-center gap-2 rounded-[var(--radius-token-full)] px-3 py-1.5 text-xs font-medium md:flex">
        <Check className="h-3.5 w-3.5 text-[var(--status-success)]" /> ISDOC ověřeno
      </div>
    </div>
  );
}

function StatBand() {
  return (
    <section className="border-y border-[var(--border-subtle)] bg-[var(--surface-sunken)]/40">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-5 py-2 md:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <s.icon className="h-5 w-5 text-[var(--brand-primary-light)]" />
            <span className="font-heading text-3xl font-bold tracking-tight md:text-4xl">{s.value}</span>
            <span className="max-w-[16rem] text-xs text-[var(--text-secondary)]">{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Section({ id, eyebrow, title, subtitle, children }: {
  id?: string; eyebrow: string; title: string; subtitle?: string; children: ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-6xl px-5 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-primary-light)]">{eyebrow}</p>
        <h2 className="mt-3 font-heading text-3xl font-bold tracking-tight md:text-[2.5rem]">{title}</h2>
        {subtitle && <p className="mt-4 text-[var(--text-secondary)]">{subtitle}</p>}
      </div>
      <div className="mt-14">{children}</div>
    </section>
  );
}

function HowItWorks() {
  return (
    <Section id="jak" eyebrow="Jak to funguje" title="Tři kroky, žádné přepisování">
      <div className="relative grid gap-6 md:grid-cols-3">
        {/* connector line */}
        <div
          aria-hidden="true"
          className="absolute left-[16%] right-[16%] top-[2.1rem] hidden h-px md:block"
          style={{ background: 'linear-gradient(to right, transparent, var(--border-brand), transparent)' }}
        />
        {STEPS.map((s, i) => (
          <div key={s.title} className="card-lift relative rounded-[var(--radius-token-xl)] border border-[var(--border-default)] bg-[var(--surface-default)] p-7">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-token-lg)] text-white"
              style={{ background: 'var(--accent-gradient)', boxShadow: 'var(--accent-glow)' }}
            >
              <s.icon className="h-5 w-5" />
            </div>
            <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--brand-primary-light)]">Krok {i + 1}</p>
            <h3 className="mt-1.5 text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{s.text}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Features() {
  return (
    <Section id="funkce" eyebrow="Funkce" title="Bezobslužně od příjmu po zaúčtování" subtitle="Foldera odvede přepisování za vás. Na rozdíl od jiných řešení nepracujete v žádném dalším rozhraní — jen ve svém účetnictví zkontrolujete, co dorazilo.">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card-lift group rounded-[var(--radius-token-xl)] border border-[var(--border-default)] bg-[var(--surface-default)] p-7">
            <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-token-lg)] bg-[var(--brand-primary-subtle)] text-[var(--brand-primary-light)] transition-colors group-hover:bg-[var(--brand-primary)] group-hover:text-white">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{f.text}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Pricing() {
  const included = [
    '50 dokladů v ceně každý měsíc',
    'Každý další doklad jen 2 Kč',
    'Neomezeně uživatelů',
    'Sběrný e-mail, OneDrive i Google Drive',
    'Faktury, dobropisy i účtenky',
    'Automatické zaúčtování (historie / AI)',
  ];
  return (
    <Section id="cenik" eyebrow="Ceník" title="Jeden jednoduchý plán" subtitle="Bez závazků. Fakturováno běžnou fakturou každý měsíc.">
      <div className="mx-auto max-w-md">
        <div className="gradient-border card-lift relative overflow-hidden rounded-[var(--radius-token-xl)] p-8 shadow-[var(--shadow-lg)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-40 blur-3xl"
            style={{ background: 'radial-gradient(closest-side, var(--brand-primary), transparent)' }}
          />
          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-token-full)] bg-[var(--brand-primary-subtle)] px-3 py-1 text-xs font-semibold text-[var(--brand-primary-light)]">
            <Sparkles className="h-3.5 w-3.5" /> Vše v jednom
          </span>
          <div className="mt-5 flex items-baseline gap-2">
            <span className="font-heading text-5xl font-bold tracking-tight">99 Kč</span>
            <span className="text-[var(--text-secondary)]">/ měsíc · firma</span>
          </div>
          <p className="mt-2 text-sm text-[var(--text-tertiary)]">7 dní zdarma na vyzkoušení (až 10 dokladů), bez karty.</p>
          <ul className="mt-7 space-y-3">
            {included.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--status-success-subtle)]">
                  <Check className="h-3 w-3 text-[var(--status-success)]" />
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Link to="/register" className="mt-8 block">
            <Button className="w-full">Vyzkoušet 7 dní zdarma</Button>
          </Link>
        </div>
      </div>
    </Section>
  );
}

function Faq() {
  return (
    <Section eyebrow="Časté dotazy" title="Co se nejčastěji ptáte">
      <div className="mx-auto max-w-2xl space-y-3">
        {FAQ.map((item) => (
          <details
            key={item.q}
            className="group rounded-[var(--radius-token-lg)] border border-[var(--border-default)] bg-[var(--surface-default)] px-5 py-4 transition-colors hover:border-[var(--border-strong)]"
          >
            <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold marker:content-['']">
              {item.q}
              <span className="ml-4 text-lg text-[var(--text-tertiary)] transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
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
    'h-10 w-full rounded-[var(--radius-token-md)] border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] transition-colors focus:border-[var(--brand-primary)] focus:outline-none';

  return (
    <Section id="kontakt" eyebrow="Kontakt" title="Máte dotaz? Napište nám" subtitle="Ozveme se obvykle do jednoho pracovního dne.">
      <div className="glass mx-auto max-w-lg rounded-[var(--radius-token-xl)] p-7">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--status-success-subtle)]">
              <Check className="h-6 w-6 text-[var(--status-success)]" />
            </span>
            <p className="text-sm font-semibold">Děkujeme, zpráva odešla.</p>
            <p className="text-sm text-[var(--text-secondary)]">Brzy se vám ozveme.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input required placeholder="Jméno" className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input required type="email" placeholder="E-mail" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <input placeholder="Firma (nepovinné)" className={inputClass} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            <textarea
              required
              placeholder="Vaše zpráva"
              rows={4}
              className={cn(inputClass, 'h-auto py-2')}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
            {error && <p className="text-xs text-[var(--status-error-text)]">{error}</p>}
            <Button type="submit" loading={submitting} className="w-full">Odeslat</Button>
          </form>
        )}
      </div>
    </Section>
  );
}

function CtaBand({ appHref, loggedIn }: { appHref: string; loggedIn: boolean }) {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-24">
      <div className="relative overflow-hidden rounded-[var(--radius-token-xl)] border border-[var(--border-brand)] px-6 py-16 text-center">
        <div aria-hidden="true" className="mesh-bg opacity-80" />
        <div className="relative">
          <h2 className="font-heading text-3xl font-bold tracking-tight md:text-4xl">
            Začněte zpracovávat faktury <span className="text-gradient">za dvě minuty</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[var(--text-secondary)]">
            Připojte zdroj, zadejte přístup do ABRA Flexi a Foldera se postará o zbytek.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to={appHref}>
              <Button icon={<ArrowRight />}>{loggedIn ? 'Do aplikace' : 'Vyzkoušet 7 dní zdarma'}</Button>
            </Link>
            <a href="#cenik">
              <Button variant="secondary">Zobrazit ceník</Button>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--border-subtle)]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-[var(--text-tertiary)] sm:flex-row">
        <div className="flex items-center gap-2">
          <BrandMark className="h-7 w-7 rounded-[9px] text-sm" />
          <span className="font-heading font-bold text-[var(--text-secondary)]">Foldera</span>
        </div>
        <p>© {2026} Foldera · Faktury automaticky do ABRA Flexi</p>
        <div className="flex items-center gap-5">
          <Link to="/podminky" className="hover:text-[var(--text-primary)]">Obchodní podmínky</Link>
          <Link to="/login" className="hover:text-[var(--text-primary)]">Přihlásit se</Link>
          <a href="#cenik" className="hover:text-[var(--text-primary)]">Ceník</a>
        </div>
      </div>
    </footer>
  );
}
