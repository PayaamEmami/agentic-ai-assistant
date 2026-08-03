import type { ListenerTranscriptSegment } from './types';

export interface ListenerTranscriptEventResult {
  changed: boolean;
  completed?: ListenerTranscriptSegment;
  error?: string;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function parseListenerRealtimeEvent(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export class ListenerTranscriptStore {
  private readonly segments = new Map<string, ListenerTranscriptSegment>();
  private nextOrder = 0;

  apply(event: Record<string, unknown>): ListenerTranscriptEventResult {
    const type = stringValue(event['type']);
    if (type === 'error') {
      const error = event['error'];
      const message =
        error && typeof error === 'object' && !Array.isArray(error)
          ? stringValue((error as Record<string, unknown>)['message'])
          : undefined;
      return { changed: false, error: message ?? 'Realtime transcription failed.' };
    }
    if (
      type !== 'conversation.item.input_audio_transcription.delta' &&
      type !== 'conversation.item.input_audio_transcription.completed'
    ) {
      return { changed: false };
    }
    const itemId = stringValue(event['item_id']);
    if (!itemId) {
      return { changed: false };
    }
    const existing = this.segments.get(itemId);
    const order = existing?.order ?? this.nextOrder++;
    if (type.endsWith('.delta')) {
      if (existing?.final) {
        return { changed: false };
      }
      const delta = stringValue(event['delta']) ?? '';
      if (!delta) {
        return { changed: false };
      }
      this.segments.set(itemId, {
        itemId,
        text: `${existing?.text ?? ''}${delta}`,
        final: false,
        order,
      });
      return { changed: true };
    }
    if (existing?.final) {
      return { changed: false };
    }
    const transcript = (stringValue(event['transcript']) ?? existing?.text ?? '').trim();
    if (!transcript) {
      return { changed: false };
    }
    const completed = { itemId, text: transcript, final: true, order };
    this.segments.set(itemId, completed);
    return { changed: true, completed };
  }

  values(): ListenerTranscriptSegment[] {
    return Array.from(this.segments.values()).sort((left, right) => left.order - right.order);
  }

  finalText(): string {
    return this.values()
      .filter((segment) => segment.final)
      .map((segment) => segment.text)
      .join('\n')
      .trim();
  }

  clear(): void {
    this.segments.clear();
    this.nextOrder = 0;
  }
}
