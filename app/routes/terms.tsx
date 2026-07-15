import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { LogoMark } from '~/components/ui/Logo';
import { cn } from '~/lib/utils';

const SITE_URL = 'https://foldera.cz';

export function meta() {
  return [
    { title: 'Obchodní podmínky - Foldera' },
    { name: 'description', content: 'Obchodní podmínky služby Foldera - automatické zpracování přijatých faktur do ABRA Flexi.' },
    { name: 'robots', content: 'index, follow' },
    { tagName: 'link', rel: 'canonical', href: `${SITE_URL}/podminky` },
  ];
}

const UPDATED = '15. 7. 2026';

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 font-heading text-xl font-bold tracking-tight">{children}</h2>;
}
function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('mt-3 text-sm leading-relaxed text-[var(--text-secondary)]', className)}>{children}</p>;
}

export default function Terms() {
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
        <h1 className="font-heading text-3xl font-bold tracking-tight md:text-4xl">Obchodní podmínky</h1>
        <p className="mt-3 text-sm text-[var(--text-tertiary)]">Účinné od {UPDATED}</p>

        <H2>1. Poskytovatel</H2>
        <P>
          Službu Foldera provozuje <strong className="text-[var(--text-primary)]">Ing. Josef Horňák</strong>, IČO 19910916,
          se sídlem Topolová 4411, 276 01 Mělník (dále jen „poskytovatel"). Poskytovatel není plátcem DPH.
          Kontakt: <a className="text-[var(--text-link)] underline underline-offset-2" href="mailto:josef.hornak@foldera.cz">josef.hornak@foldera.cz</a>.
        </P>

        <H2>2. Předmět služby</H2>
        <P>
          Foldera je webová služba, která automaticky zpracovává přijaté faktury, dobropisy a účtenky: vytěží z nich
          údaje, zkontroluje duplicity a založí odpovídající doklad v účetním systému ABRA Flexi (FlexiBee) zákazníka
          včetně přílohy. Připojení k ABRA Flexi probíhá přes její REST API na základě údajů zadaných zákazníkem.
        </P>

        <H2>3. Registrace a účet</H2>
        <P>
          Pro užívání služby je nutná registrace a ověření e-mailové adresy. Zákazník odpovídá za správnost zadaných
          údajů a za zabezpečení svých přístupových údajů. Jeden účet může spravovat libovolný počet uživatelů a firem.
        </P>

        <H2>4. Zkušební období</H2>
        <P>
          Nový účet má nárok na bezplatné zkušební období v délce 7 dní, nejvýše však na 10 zpracovaných dokladů (podle
          toho, co nastane dříve). Zkušební období se vztahuje na účet, nikoli na jednotlivou firmu. Po jeho vyčerpání
          je pro další zpracování nutné aktivovat předplatné.
        </P>

        <H2>5. Cena a platební podmínky</H2>
        <P>
          Cena předplatného je <strong className="text-[var(--text-primary)]">199 Kč měsíčně za každou firmu</strong>. V ceně je zahrnuto 100 zpracovaných
          dokladů měsíčně; každý další doklad nad tento rámec je zpoplatněn částkou 2 Kč. Poskytovatel není plátcem DPH,
          ceny jsou konečné.
        </P>
        <P>
          Vyúčtování probíhá zpětně za uplynulý kalendářní měsíc formou faktury, kterou poskytovatel zašle na e-mail
          zákazníka (běžně se splatností 14 dní). Předplatné lze kdykoli zrušit v nastavení; zrušením se zastaví další
          zpracování dokladů, již vzniklé závazky tím nezanikají.
        </P>

        <H2>6. Práva a povinnosti zákazníka</H2>
        <P>
          Zákazník se zavazuje službu užívat v souladu s právními předpisy a nezneužívat ji k jednání, které by ji mohlo
          poškodit nebo přetížit. Zákazník odpovídá za obsah dokladů, které do služby vkládá, a za to, že je oprávněn je
          zpracovávat. Za správnost výsledného zaúčtování v ABRA Flexi odpovídá zákazník - doporučujeme vytěžené doklady
          kontrolovat.
        </P>

        <H2>7. Zpracování souborů a ochrana údajů</H2>
        <P>
          Originální soubory faktur se zpracují a nahrají jako příloha do ABRA Flexi zákazníka. Poskytovatel je poté
          uchovává jen po nezbytně nutnou dobu - u úspěšně zpracovaných dokladů nejdéle 24 hodin, u dokladů, které
          skončily chybou nebo čekají na schválení, do doby, než je zákazník odešle do účetnictví nebo smaže. Pak
          v aplikaci zůstávají pouze vytěžená metadata nezbytná pro provoz služby a případné zopakování exportu.
          Přístupové údaje k ABRA Flexi a e-mailovým schránkám jsou v databázi uloženy šifrovaně.
        </P>
        <P>
          Poskytovatel zpracovává osobní údaje v rozsahu nezbytném pro poskytování služby a v souladu s nařízením GDPR.
          Podrobnosti upravují{' '}
          <Link to="/ochrana-udaju" className="text-[var(--text-link)] underline underline-offset-2">zásady ochrany osobních údajů</Link>{' '}
          a pro údaje v dokladech{' '}
          <Link to="/zpracovani-udaju" className="text-[var(--text-link)] underline underline-offset-2">podmínky zpracování osobních údajů</Link>{' '}
          (zpracovatelská smlouva dle čl. 28 GDPR). Žádost týkající se osobních údajů lze zaslat na uvedený kontaktní e-mail.
        </P>

        <H2>8. Dostupnost a odpovědnost</H2>
        <P>
          Poskytovatel vyvíjí přiměřené úsilí o nepřetržitý provoz, službu však poskytuje „tak jak je", bez záruky
          nepřerušené dostupnosti. Poskytovatel neodpovídá za škody vzniklé nesprávně vytěženými údaji, výpadkem služby
          třetích stran (zejména ABRA Flexi nebo e-mailových a cloudových úložišť) ani za následky chybně zadaných údajů
          ze strany zákazníka. Případná odpovědnost poskytovatele je omezena do výše předplatného uhrazeného za poslední
          měsíc.
        </P>

        <H2>9. Změny podmínek</H2>
        <P>
          Poskytovatel je oprávněn tyto podmínky přiměřeně měnit; o podstatných změnách bude zákazníky informovat
          e-mailem. Pokračováním v užívání služby po nabytí účinnosti změny zákazník se změnou souhlasí.
        </P>

        <H2>10. Závěrečná ustanovení</H2>
        <P>
          Vztahy neupravené těmito podmínkami se řídí právním řádem České republiky. Tyto podmínky nabývají účinnosti
          dnem uvedeným výše.
        </P>

        <div className="mt-12 border-t border-[var(--border-subtle)] pt-6 text-sm text-[var(--text-tertiary)]">
          <Link to="/" className="text-[var(--text-link)] underline underline-offset-2">Zpět na úvod</Link>
        </div>
      </main>
    </div>
  );
}
