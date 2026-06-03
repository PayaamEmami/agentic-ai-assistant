'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastInput {
  message: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastRecord extends Required<Pick<ToastInput, 'message'>> {
  id: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastContextValue {
  show: (input: ToastInput) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantClasses: Record<ToastVariant, string> = {
  success: 'border-success/30 bg-surface-elevated text-success',
  error: 'border-error/30 bg-surface-elevated text-error',
  warning: 'border-warning/30 bg-surface-elevated text-warning',
  info: 'border-border bg-surface-elevated text-foreground',
};

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timeout = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast.duration, toast.id]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'toast-enter pointer-events-auto w-full max-w-sm rounded-xl border px-4 py-3 text-sm shadow-lg',
        variantClasses[toast.variant],
      )}
    >
      {toast.message}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextIdRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((input: ToastInput) => {
    const id = `toast-${nextIdRef.current++}`;
    setToasts((previous) => [
      ...previous,
      {
        id,
        message: input.message,
        variant: input.variant ?? 'info',
        duration: input.duration ?? 4_500,
      },
    ]);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (message, duration) => show({ message, variant: 'success', duration }),
      error: (message, duration) => show({ message, variant: 'error', duration }),
      info: (message, duration) => show({ message, variant: 'info', duration }),
      warning: (message, duration) => show({ message, variant: 'warning', duration }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
