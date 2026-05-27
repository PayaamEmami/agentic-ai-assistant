import type { BrowserVoiceSupport } from './types';

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
