import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type BadgeVariant = 'neutral' | 'accent' | 'success' | 'error' | 'warning';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-elevated text-foreground-muted',
  accent: 'bg-accent/20 text-accent',
  success: 'bg-success/20 text-success',
  error: 'bg-error/20 text-error',
  warning: 'bg-warning/20 text-warning',
};

export function Badge({ className, variant = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn('rounded-full px-2 py-0.5 text-xs font-medium', variantClasses[variant], className)}
      {...props}
    />
  );
}
