import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        'w-full appearance-none rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
