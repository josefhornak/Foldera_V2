import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '~/lib/utils';

interface HelpHintProps {
  /** Accessible label for the trigger button (e.g. "Nápověda k zadání adresy"). */
  label: string;
  /** Optional heading shown at the top of the popover. */
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * A small "?" trigger that reveals a design-tokened popover with help content.
 * Self-contained: closes on outside click and on Escape. No external deps beyond
 * the icon set. Anchored to the trigger, opens below and aligned to the end so it
 * stays inside narrow forms.
 */
export function HelpHint({ label, title, children, className }: HelpHintProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-full',
          'text-[var(--text-tertiary)] transition-colors duration-150 ease-[var(--ease-default)]',
          'hover:text-[var(--brand-primary)] focus:outline-none focus:text-[var(--brand-primary)]',
          open && 'text-[var(--brand-primary)]'
        )}
      >
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          className={cn(
            'absolute right-0 top-6 z-20 w-[19rem] max-w-[calc(100vw-2rem)]',
            'rounded-[var(--radius-token-lg)] border border-[var(--border-default)]',
            'bg-[var(--surface-raised,var(--surface-default))] p-3.5 text-left',
            'shadow-[var(--shadow-lg)]'
          )}
        >
          {title && (
            <p className="mb-2 text-xs font-semibold text-[var(--text-primary)]">{title}</p>
          )}
          <div className="space-y-2.5 text-xs leading-relaxed text-[var(--text-secondary)]">
            {children}
          </div>
        </div>
      )}
    </span>
  );
}
