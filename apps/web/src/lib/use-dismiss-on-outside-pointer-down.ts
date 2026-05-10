import { useEffect, type RefObject } from 'react';

export function useDismissOnOutsidePointerDown(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onDismiss();
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointerDown);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
    };
  }, [enabled, onDismiss, ref]);
}
