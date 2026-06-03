import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type IconButtonSize = 'sm' | 'md' | 'lg';
type IconButtonVariant = 'ghost' | 'danger' | 'success' | 'primary';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  loading?: boolean;
}

const sizeClasses: Record<IconButtonSize, string> = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-9 w-9 rounded-xl',
  lg: 'h-10 w-10 rounded-xl',
};

const variantClasses: Record<IconButtonVariant, string> = {
  ghost: 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
  danger: 'text-foreground-muted hover:bg-error/10 hover:text-error',
  success: 'text-foreground-muted hover:bg-success/10 hover:text-success',
  primary: 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
};

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
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      <span className={cn('inline-flex', loading && 'animate-spin')}>{children}</span>
    </button>
  );
});
