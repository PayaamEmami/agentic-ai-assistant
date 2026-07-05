import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export const buttonBaseClasses =
  'inline-flex shrink-0 items-center justify-center gap-2 font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

export const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-lg px-3 text-xs',
  md: 'h-10 rounded-xl px-4 text-sm',
  lg: 'h-11 rounded-xl px-5 text-sm',
};

// Action buttons use an always-visible colored border in the intent color, with a
// matching translucent background on hover. Ghost stays minimal for subtle actions.
export const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'border border-accent/60 bg-transparent text-foreground hover:border-accent hover:bg-accent/10',
  secondary:
    'border border-border-subtle bg-transparent text-foreground-muted hover:border-foreground-muted hover:bg-surface-hover hover:text-foreground',
  ghost: 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
  danger:
    'border border-error/60 bg-transparent text-error hover:border-error hover:bg-error/10',
  success:
    'border border-success/60 bg-transparent text-success hover:border-success hover:bg-success/10',
};

export const iconButtonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-9 w-9 rounded-xl',
  lg: 'h-10 w-10 rounded-xl',
};

export type IconButtonVariant = Exclude<ButtonVariant, 'secondary'>;

export const iconButtonVariants: Record<IconButtonVariant, string> = {
  ghost: 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
  primary:
    'border border-accent/60 bg-transparent text-foreground hover:border-accent hover:bg-accent/10',
  danger:
    'border border-error/60 bg-transparent text-error hover:border-error hover:bg-error/10',
  success:
    'border border-success/60 bg-transparent text-success hover:border-success hover:bg-success/10',
};

export function buttonClassName({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}): string {
  return cn(
    buttonBaseClasses,
    buttonSizes[size],
    buttonVariants[variant],
    fullWidth && 'w-full',
    className,
  );
}
