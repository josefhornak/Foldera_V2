import { useId } from 'react';
import { cn } from '~/lib/utils';

/**
 * Foldera brand mark — violet rounded tile with the stacked "F" bars (matches
 * the favicon / PWA icons). Single source of truth for the in-app brand mark.
 * `className` controls the size (e.g. `h-9 w-9`); the rounded tile is baked in.
 */
export function LogoMark({ className }: { className?: string }) {
  const gid = useId();
  return (
    <svg viewBox="0 0 100 100" className={cn('h-8 w-8', className)} role="img" aria-label="Foldera" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gid} x1="8" y1="0" x2="92" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#7c4ef0" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="24" fill={`url(#${gid})`} />
      <g transform="translate(7 -5) skewX(-9)" fill="#ffffff">
        <rect x="28" y="22" width="48" height="12.5" rx="6.25" />
        <rect x="28" y="40" width="37" height="12.5" rx="6.25" />
        <rect x="28" y="58" width="27" height="12.5" rx="6.25" />
        <rect x="28" y="76" width="17" height="12.5" rx="6.25" />
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
