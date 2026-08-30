import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-foreground-inactive focus:border-accent disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
});
