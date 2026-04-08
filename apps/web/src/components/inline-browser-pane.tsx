'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { McpBrowserSessionSummary } from '@/lib/api-client';
import { useBrowserSession } from '@/lib/use-browser-session';
import { BrowserSessionSurface } from './browser-session-surface';

interface InlineBrowserPaneProps {
  sessionId: string;
  className?: string;
  onClose: () => void;
  onSessionChange?: (session: McpBrowserSessionSummary) => void;
}

export function InlineBrowserPane({
  sessionId,
  className,
  onClose,
  onSessionChange,
}: InlineBrowserPaneProps) {
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

  useEffect(() => {
    if (!session || !onSessionChange) {
      return;
    }
    onSessionChange(session);
  }, [onSessionChange, session]);

  const handleSave = async () => {
    const response = await persistSession(true);
    if (response?.session) {
      onSessionChange?.(response.session);
      onClose();
    }
  };

  const handleCancel = async () => {
    const response = await cancelSession();
    if (response?.session) {
      onSessionChange?.(response.session);
      onClose();
    }
  };

  return (
    <div className={className}>
      <BrowserSessionSurface
        variant="dock"
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
        onClose={onClose}
        onToggleDisplay={() => router.push(`/chat/browser/${sessionId}?returnTo=${encodeURIComponent(`/chat?browserSessionId=${sessionId}&browserView=dock`)}`)}
      />
    </div>
  );
}
