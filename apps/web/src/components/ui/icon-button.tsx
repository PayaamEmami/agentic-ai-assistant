import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import {
  iconButtonSizes,
  iconButtonVariants,
  type IconButtonVariant,
} from '@/components/ui/button-variants';

type IconButtonSize = keyof typeof iconButtonSizes;

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    className,
    size = 'md',
    type = 'button',
    variant = 'ghost',
    loading = false,
    disabled,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-foreground-muted',
        loading && 'cursor-wait',
        iconButtonSizes[size],
        iconButtonVariants[variant],
        className,
      )}
      {...props}
    >
      <span className={cn('inline-flex', loading && 'animate-spin')}>{children}</span>
    </button>
  );
});
