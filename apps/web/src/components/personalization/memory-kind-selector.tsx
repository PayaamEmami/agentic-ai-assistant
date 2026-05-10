'use client';

import { useCallback, useRef, useState } from 'react';
import { ChevronDownIcon } from '@/components/icons';
import { MEMORY_KIND_LABELS, MEMORY_KIND_ORDER } from './personalization-model';
import { type PersonalizationMemoryKind } from '@/lib/api-client';
import { useDismissOnOutsidePointerDown } from '@/lib/use-dismiss-on-outside-pointer-down';

interface MemoryKindSelectorProps {
  value: PersonalizationMemoryKind | null;
  onChange: (value: PersonalizationMemoryKind) => void;
}

export function MemoryKindSelector({ value, onChange }: MemoryKindSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useDismissOnOutsidePointerDown(containerRef, open, close);

  return (
    <div ref={containerRef} className="relative sm:min-w-52">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface-elevated px-3 py-2 text-left text-xs font-medium text-foreground transition hover:bg-surface-hover"
      >
        <span className={value ? '' : 'text-foreground-muted'}>
          {value ? MEMORY_KIND_LABELS[value] : 'Memory type'}
        </span>
        <ChevronDownIcon />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute right-0 z-20 mt-2 w-full rounded-2xl border border-border bg-surface-elevated p-1 shadow-lg"
        >
          {MEMORY_KIND_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              role="option"
              aria-selected={kind === value}
              onClick={() => {
                onChange(kind);
                setOpen(false);
              }}
              className={`w-full rounded-xl px-3 py-2 text-left text-xs font-medium transition ${
                kind === value
                  ? 'bg-surface-accent text-foreground'
                  : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground'
              }`}
            >
              {MEMORY_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
