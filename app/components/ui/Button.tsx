import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '~/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap',
        'rounded-[var(--radius-token-md)] transition-colors duration-150 ease-[var(--ease-default)]',
        'focus-visible:outline-none focus-visible:shadow-[var(--ring-brand)]',
        'disabled:pointer-events-none disabled:opacity-50',
        'active:translate-y-px',

        variant === 'primary' && [
          'bg-[var(--brand-primary)] text-[var(--text-inverse)]',
          'hover:bg-[var(--brand-primary-hover)]',
        ],
        variant === 'secondary' && [
          'bg-[var(--surface-default)] text-[var(--text-primary)]',
          'border border-[var(--border-default)] shadow-[var(--shadow-xs)]',
          'hover:bg-[var(--surface-interactive)] hover:border-[var(--border-strong)]',
        ],
        variant === 'ghost' && [
          'text-[var(--text-secondary)]',
          'hover:text-[var(--text-primary)] hover:bg-[var(--surface-interactive)]',
        ],
        variant === 'danger' && [
          'bg-[var(--status-error)] text-[var(--text-inverse)]',
          'hover:bg-[var(--status-error-text)]',
        ],

        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-9 px-4 text-[13px]',

        className
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : icon ? (
        <span className="[&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
