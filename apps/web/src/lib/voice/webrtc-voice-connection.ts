import { parseEvent } from './utils';

export interface WebRtcVoiceConnection {
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  microphoneStream: MediaStream;
  remoteAudio: HTMLAudioElement;
}

interface ConnectWebRtcVoiceSessionOptions {
  sessionId: string;
  conversationId: string;
  exchangeSdpAnswer: (sessionId: string, conversationId: string, sdp: string) => Promise<string>;
  onRealtimeEvent: (event: { type?: string; [key: string]: unknown }) => void;
}

export async function connectWebRtcVoiceSession({
  sessionId,
  conversationId,
  exchangeSdpAnswer,
  onRealtimeEvent,
}: ConnectWebRtcVoiceSessionOptions): Promise<WebRtcVoiceConnection> {
  const peerConnection = new RTCPeerConnection();

  const remoteAudio = new Audio();
  remoteAudio.autoplay = true;

  peerConnection.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0] ?? null;
  };

  const microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of microphoneStream.getTracks()) {
    peerConnection.addTrack(track, microphoneStream);
  }

  const dataChannel = peerConnection.createDataChannel('oai-events');
  dataChannel.addEventListener('message', (messageEvent) => {
    const event = parseEvent(String(messageEvent.data));
    if (event) {
      onRealtimeEvent(event);
    }
  });

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const answerSdp = await exchangeSdpAnswer(sessionId, conversationId, offer.sdp ?? '');
  await peerConnection.setRemoteDescription({
    type: 'answer',
    sdp: answerSdp,
  });

  return {
    peerConnection,
    dataChannel,
    microphoneStream,
    remoteAudio,
  };
}
