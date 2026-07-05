import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import {
  buttonClassName,
  type ButtonSize,
  type ButtonVariant,
} from '@/components/ui/button-variants';

export type { ButtonSize, ButtonVariant } from '@/components/ui/button-variants';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  fullWidth?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    fullWidth = false,
    size = 'md',
    type = 'button',
    variant = 'primary',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonClassName({ variant, size, fullWidth, className }))}
      {...props}
    />
  );
});
