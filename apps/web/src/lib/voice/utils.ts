import type { BrowserVoiceSupport } from './types';

export const VOICE_LEVEL_BAND_COUNT = 24;

export function createEmptyVoiceLevels(bandCount = VOICE_LEVEL_BAND_COUNT) {
  return Array.from({ length: bandCount }, () => 0);
}

export function clampVoiceLevel(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function calculateVoiceLevels(
  frequencyData: Uint8Array,
  bandCount = VOICE_LEVEL_BAND_COUNT,
): number[] {
  const bucketSize = Math.max(1, Math.floor(frequencyData.length / bandCount));

  return Array.from({ length: bandCount }, (_, index) => {
    const start = index * bucketSize;
    const end = Math.min(frequencyData.length, start + bucketSize);
    let total = 0;

    for (let cursor = start; cursor < end; cursor += 1) {
      total += frequencyData[cursor] ?? 0;
    }

    const average = total / Math.max(1, end - start) / 255;
    return clampVoiceLevel(Math.sqrt(average) * 1.25);
  });
}

export function calculateVoiceVolume(levels: number[]) {
  return levels.reduce((sum, level) => sum + level, 0) / Math.max(1, levels.length);
}

export function parseEvent(raw: string): { type?: string; [key: string]: unknown } | null {
  try {
    return JSON.parse(raw) as { type?: string; [key: string]: unknown };
  } catch {
    return null;
  }
}

export function getBrowserVoiceSupport(): BrowserVoiceSupport {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    typeof RTCPeerConnection === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    return {
      supported: false,
      reason: 'Live voice mode is not supported in this browser.',
    };
  }

  return { supported: true };
}
