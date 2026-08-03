import { describe, expect, it } from 'vitest';
import { ListenerTranscriptStore, parseListenerRealtimeEvent } from './transcript-store';

describe('ListenerTranscriptStore', () => {
  it('accumulates deltas and replaces them with the final transcript', () => {
    const store = new ListenerTranscriptStore();
    store.apply({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'item-1',
      delta: 'Gradient ',
    });
    store.apply({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'item-1',
      delta: 'descent',
    });
    const result = store.apply({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-1',
      transcript: 'Gradient descent.',
    });

    expect(result.completed?.text).toBe('Gradient descent.');
    expect(store.finalText()).toBe('Gradient descent.');
  });

  it('keeps first-seen order when completion events arrive out of order', () => {
    const store = new ListenerTranscriptStore();
    store.apply({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'first',
      delta: 'First',
    });
    store.apply({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'second',
      delta: 'Second',
    });
    store.apply({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'second',
      transcript: 'Second.',
    });
    store.apply({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'first',
      transcript: 'First.',
    });

    expect(store.finalText()).toBe('First.\nSecond.');
  });

  it('ignores duplicate completion events', () => {
    const store = new ListenerTranscriptStore();
    const event = {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-1',
      transcript: 'Once.',
    };
    expect(store.apply(event).changed).toBe(true);
    expect(store.apply(event).changed).toBe(false);
  });
});

describe('parseListenerRealtimeEvent', () => {
  it('accepts objects and rejects invalid payloads', () => {
    expect(parseListenerRealtimeEvent('{"type":"session.created"}')).toEqual({
      type: 'session.created',
    });
    expect(parseListenerRealtimeEvent('not json')).toBeNull();
    expect(parseListenerRealtimeEvent('[]')).toBeNull();
  });
});
