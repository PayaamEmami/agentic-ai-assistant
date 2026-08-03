import type { ListenerConcept, ListenerSession } from '@/lib/api/listener';

export type ListenerAudioSource = 'microphone' | 'browser_tab';
export type ListenerPhase = 'idle' | 'connecting' | 'listening' | 'error';

export interface ListenerTranscriptSegment {
  itemId: string;
  text: string;
  final: boolean;
  order: number;
}

export interface ListenerConnection {
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  mediaStream: MediaStream;
}

export type { ListenerConcept, ListenerSession };
