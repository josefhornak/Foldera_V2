import { cn } from '~/lib/utils';

/**
 * Foldera brand mark — purple rounded tile with the lime stacked-pages glyph.
 * Mirrors public/logo.svg (and the favicon) so the in-app branding matches.
 * Gradient ids are suffixed per-instance to stay unique when several render.
 */
export function LogoMark({ className, id = 'a' }: { className?: string; id?: string }) {
  const bg = `fld-bg-${id}`;
  const fg = `fld-fg-${id}`;
  return (
    <svg
      viewBox="0 0 209 209"
      className={cn('h-8 w-8', className)}
      role="img"
      aria-label="Foldera"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="209" y2="209" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3A214A" />
          <stop offset="100%" stopColor="#1F1230" />
        </linearGradient>
        <linearGradient id={fg} x1="0" y1="36" x2="0" y2="168" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#DCE88A" />
          <stop offset="50%" stopColor="#AFC96A" />
          <stop offset="100%" stopColor="#6F8835" />
        </linearGradient>
      </defs>
      <rect width="208.5" height="208.5" rx="45" fill={`url(#${bg})`} />
      <g>
        <rect x="64" y="36" width="80" height="16" rx="8" fill={`url(#${fg})`} />
        <rect x="64" y="60" width="68" height="16" rx="8" fill={`url(#${fg})`} />
        <rect x="64" y="84" width="52" height="84" rx="13" fill={`url(#${fg})`} />
      </g>
    </svg>
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
  id = 'a',
}: {
  className?: string;
  tone?: 'light' | 'dark';
  markOnly?: boolean;
  id?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark id={id} className="h-7 w-7" />
      {!markOnly && (
        <span
          className={cn(
            'text-lg font-extrabold tracking-tight',
            tone === 'dark' ? 'text-white' : 'text-[var(--brand-primary)]'
          )}
        >
          Foldera
        </span>
      )}
    </span>
  );
}
