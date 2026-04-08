'use client';

import { useRouter } from 'next/navigation';
import { useBrowserSession } from '@/lib/use-browser-session';
import { BrowserSessionSurface } from './browser-session-surface';

interface BrowserWorkspaceProps {
  sessionId: string;
  returnToChatUrl?: string | null;
}

export function BrowserWorkspace({ sessionId, returnToChatUrl }: BrowserWorkspaceProps) {
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
    requestControl,
    sendBrowserEvent,
  } = useBrowserSession({
    sessionId,
  });

  const handleSave = async () => {
    const response = await persistSession(true);
    if (response?.session) {
      router.push(returnToChatUrl ?? '/chat/apps');
    }
  };

  const handleCancel = async () => {
    const response = await cancelSession();
    if (response?.session) {
      router.push(returnToChatUrl ?? '/chat/apps');
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
      onRequestControl={() => {
        requestControl();
      }}
      onToggleDisplay={() =>
        router.push(returnToChatUrl ?? `/chat?browserSessionId=${sessionId}&browserView=dock`)
      }
      onClose={() => router.push(returnToChatUrl ?? '/chat/apps')}
      closeLabel="Back"
    />
  );
}
