import type { ListenerConnection } from './types';
import { parseListenerRealtimeEvent } from './transcript-store';

interface ConnectListenerOptions {
  sessionId: string;
  conversationId: string;
  mediaStream: MediaStream;
  exchangeSdpAnswer: (
    sessionId: string,
    conversationId: string,
    sdp: string,
  ) => Promise<string>;
  onRealtimeEvent: (event: Record<string, unknown>) => void;
  onCaptureEnded: () => void;
}

export async function connectListenerSession({
  sessionId,
  conversationId,
  mediaStream,
  exchangeSdpAnswer,
  onRealtimeEvent,
  onCaptureEnded,
}: ConnectListenerOptions): Promise<ListenerConnection> {
  const peerConnection = new RTCPeerConnection();
  const audioTrack = mediaStream.getAudioTracks()[0];
  if (!audioTrack) {
    peerConnection.close();
    throw new Error('No audio track is available for Listener Mode.');
  }
  audioTrack.addEventListener('ended', onCaptureEnded, { once: true });
  peerConnection.addTrack(audioTrack, mediaStream);

  const dataChannel = peerConnection.createDataChannel('oai-events');
  dataChannel.addEventListener('message', (messageEvent) => {
    const event = parseListenerRealtimeEvent(String(messageEvent.data));
    if (event) {
      onRealtimeEvent(event);
    }
  });

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  const answerSdp = await exchangeSdpAnswer(
    sessionId,
    conversationId,
    offer.sdp ?? '',
  );
  await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  return { peerConnection, dataChannel, mediaStream };
}

export function closeListenerConnection(connection: ListenerConnection | null | undefined): void {
  if (!connection) {
    return;
  }
  connection.dataChannel.close();
  connection.peerConnection.getSenders().forEach((sender) => sender.track?.stop());
  connection.peerConnection.close();
  connection.mediaStream.getTracks().forEach((track) => track.stop());
}
