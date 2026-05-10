import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type AlertVariant = 'error' | 'success' | 'warning';

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
}

const variantClasses: Record<AlertVariant, string> = {
  error: 'border-error/30 bg-error/10 text-error',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
};

export function Alert({ className, variant = 'error', ...props }: AlertProps) {
  return (
    <div
      className={cn('rounded-xl border px-3 py-2 text-sm', variantClasses[variant], className)}
      {...props}
    />
  );
}
