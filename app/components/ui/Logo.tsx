import { cn } from '~/lib/utils';

/**
 * Foldera brand mark — violet rounded tile with a white "F", matching the
 * landing-page header (and the favicon). Single source of truth for the in-app
 * brand mark.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-[9px] text-[15px] font-bold text-white [background:var(--accent-gradient)]',
        className
      )}
      style={{ boxShadow: 'var(--accent-glow)' }}
      aria-label="Foldera"
      role="img"
    >
      F
    </span>
  );
}

/**
 * Full lockup: mark + "Foldera" wordmark. `tone` switches the wordmark colour
 * for dark (sidebar) vs light backgrounds. `markOnly` renders just the glyph.
 */
export function Logo({
  className,
  tone = 'light',
  markOnly = false,
}: {
  className?: string;
  tone?: 'light' | 'dark';
  markOnly?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      {!markOnly && (
        <span
          className={cn(
            'font-heading text-lg font-bold tracking-tight',
            tone === 'dark' ? 'text-white' : 'text-[var(--text-primary)]'
          )}
        >
          Foldera
        </span>
      )}
    </span>
  );
}
