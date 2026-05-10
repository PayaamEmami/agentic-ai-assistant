import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: 'default' | 'transparent';
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, variant = 'default', ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        variant === 'default'
          ? 'resize-none rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-sm leading-6 text-foreground outline-none transition placeholder:text-foreground-inactive focus:border-accent'
          : 'w-full resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-foreground-inactive',
        className,
      )}
      {...props}
    />
  );
});
