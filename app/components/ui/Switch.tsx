import { cn } from '~/lib/utils';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-[var(--radius-token-full)]',
        'transition-colors duration-200 ease-[var(--ease-default)]',
        'focus-visible:outline-none focus-visible:shadow-[var(--ring-brand)]',
        'disabled:opacity-50 disabled:pointer-events-none',
        checked
          ? 'bg-[var(--brand-primary)] shadow-[0_0_12px_rgba(var(--brand-primary-rgb),0.5)]'
          : 'bg-[var(--border-strong)]'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-[var(--shadow-xs)]',
          'transition-transform duration-200 ease-[var(--ease-spring)]',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        )}
      />
    </button>
  );
}
