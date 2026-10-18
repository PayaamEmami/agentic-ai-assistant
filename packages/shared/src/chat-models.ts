export const CHAT_MODEL_IDS = ['gpt-5.6-luna', 'gpt-6.1-sol', 'gpt-6-luna'] as const;

export type ChatModelId = (typeof CHAT_MODEL_IDS)[number];

/** Model stored on conversations that existed before the picker. */
export const LEGACY_CHAT_MODEL: ChatModelId = 'gpt-5.6-luna';

/** Model a new interactive thread uses until the picker is changed. */
export const DEFAULT_NEW_CHAT_MODEL: ChatModelId = 'gpt-6-luna';

export const PICKER_CHAT_MODELS = [
  { id: 'gpt-6.1-sol', label: 'Sol', detail: 'GPT-6.1' },
  { id: 'gpt-6-luna', label: 'Luna', detail: 'GPT-6' },
] as const satisfies ReadonlyArray<{ id: ChatModelId; label: string; detail: string }>;

export function isChatModelId(value: string): value is ChatModelId {
  return (CHAT_MODEL_IDS as readonly string[]).includes(value);
}
