import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '~/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ className, error, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'h-9 w-full px-3 text-[13px] rounded-[var(--radius-token-md)]',
        'bg-[var(--surface-default)] text-[var(--text-primary)]',
        'placeholder:text-[var(--text-placeholder)]',
        'border border-[var(--border-default)]',
        'transition-colors duration-150 ease-[var(--ease-default)]',
        'hover:border-[var(--border-strong)]',
        'focus:outline-none focus:border-[var(--brand-primary)] focus:shadow-[var(--ring-brand)]',
        'disabled:opacity-50 disabled:pointer-events-none',
        error && 'border-[var(--border-error)]',
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 px-3 pr-8 text-[13px] rounded-[var(--radius-token-md)]',
        'bg-[var(--surface-default)] text-[var(--text-primary)]',
        'border border-[var(--border-default)]',
        'transition-colors duration-150 ease-[var(--ease-default)]',
        'hover:border-[var(--border-strong)]',
        'focus:outline-none focus:border-[var(--brand-primary)] focus:shadow-[var(--ring-brand)]',
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-[var(--text-secondary)]">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-[var(--text-tertiary)]">{hint}</p>}
    </div>
  );
}
