import type { ListenerAudioSource } from './types';

export async function acquireListenerMedia(source: ListenerAudioSource): Promise<MediaStream> {
  if (source === 'microphone') {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('Choose a browser tab and enable “Share tab audio,” then try again.');
  }
  stream.getVideoTracks().forEach((track) => track.stop());
  return new MediaStream(audioTracks);
}

export function stopListenerMedia(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}
