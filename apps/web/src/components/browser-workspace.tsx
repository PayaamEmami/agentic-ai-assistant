'use client';

import { useRouter } from 'next/navigation';
import { useBrowserSession } from '@/lib/use-browser-session';
import { BrowserSessionSurface } from './browser-session-surface';

interface BrowserWorkspaceProps {
  sessionId: string;
}

export function BrowserWorkspace({ sessionId }: BrowserWorkspaceProps) {
  const router = useRouter();
  const {
    session,
    pages,
    selectedPage,
    addressValue,
    setAddressValue,
    frameUrl,
    frameSize,
    controlGranted,
    socketState,
    isTouchDevice,
    error,
    isSaving,
    isCancelling,
    controlsDisabled,
    reconnect,
    persistSession,
    cancelSession,
    sendBrowserEvent,
  } = useBrowserSession({
    sessionId,
  });

  const handleSave = async () => {
    const response = await persistSession(true);
    if (response?.session) {
      router.push('/chat/apps');
    }
  };

  const handleCancel = async () => {
    const response = await cancelSession();
    if (response?.session) {
      router.push('/chat/apps');
    }
  };

  return (
    <BrowserSessionSurface
      variant="fullscreen"
      session={session}
      pages={pages}
      selectedPage={selectedPage}
      addressValue={addressValue}
      setAddressValue={setAddressValue}
      frameUrl={frameUrl}
      frameSize={frameSize}
      controlGranted={controlGranted}
      socketState={socketState}
      isTouchDevice={isTouchDevice}
      error={error}
      controlsDisabled={controlsDisabled}
      isSaving={isSaving}
      isCancelling={isCancelling}
      sendBrowserEvent={sendBrowserEvent}
      reconnect={reconnect}
      onSave={handleSave}
      onCancel={handleCancel}
      onClose={() => router.push('/chat/apps')}
      closeLabel="Back"
    />
  );
}
