export interface ListenerBrowserSupport {
  microphone: boolean;
  browserTab: boolean;
}

export function getListenerBrowserSupport(): ListenerBrowserSupport {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { microphone: false, browserTab: false };
  }
  const mediaDevices = navigator.mediaDevices as Partial<MediaDevices> | undefined;
  const desktopViewport = window.matchMedia('(min-width: 768px)').matches;
  return {
    microphone: Boolean(mediaDevices?.getUserMedia && typeof RTCPeerConnection !== 'undefined'),
    browserTab: Boolean(
      desktopViewport &&
        mediaDevices?.getDisplayMedia &&
        typeof RTCPeerConnection !== 'undefined',
    ),
  };
}
