'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LEGACY_CHAT_MODEL,
  PICKER_CHAT_MODELS,
  type ChatModelId,
} from '@aaa/shared';
import { ModelIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';
import { useDismissOnOutsidePointerDown } from '@/lib/use-dismiss-on-outside-pointer-down';

interface ModelPickerProps {
  chatModel: ChatModelId;
  disabled?: boolean;
  onChange: (model: ChatModelId) => void;
}

const LEGACY_CHOICE = {
  id: LEGACY_CHAT_MODEL,
  label: 'GPT-5.6 Luna',
  detail: 'Current model',
} as const;

function choiceFor(model: ChatModelId) {
  switch (model) {
    case 'gpt-6.1-sol':
      return { id: model, label: 'Sol', detail: 'GPT-6.1' } as const;
    case 'gpt-6-luna':
      return { id: model, label: 'Luna', detail: 'GPT-6' } as const;
    case 'gpt-5.6-luna':
      return LEGACY_CHOICE;
  }
}

export function ModelPicker({ chatModel, disabled = false, onChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissOnOutsidePointerDown(menuRef, open, close);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const selected = choiceFor(chatModel);
  const choices = chatModel === LEGACY_CHAT_MODEL
    ? [LEGACY_CHOICE, ...PICKER_CHAT_MODELS]
    : PICKER_CHAT_MODELS;

  return (
    <div ref={menuRef} className="relative">
      <IconButton
        size="lg"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Chat model: ${selected.label}`}
        aria-label={`Chat model: ${selected.label}`}
        onClick={() => setOpen((current) => !current)}
      >
        <ModelIcon />
      </IconButton>
      {open ? (
        <div
          role="listbox"
          aria-label="Chat model"
          className="absolute bottom-full left-0 z-30 mb-2 w-44 rounded-lg border border-border bg-surface-elevated p-1 shadow-lg"
        >
          {choices.map((choice) => {
            const isSelected = choice.id === chatModel;
            return (
              <button
                key={choice.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover',
                  isSelected ? 'text-foreground' : 'text-foreground-muted',
                )}
                onClick={() => {
                  setOpen(false);
                  if (choice.id !== chatModel) {
                    onChange(choice.id);
                  }
                }}
              >
                <span className="min-w-0">
                  <span className="block text-sm">{choice.label}</span>
                  <span className="block text-xs text-foreground-muted">{choice.detail}</span>
                </span>
                {isSelected ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="shrink-0"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
