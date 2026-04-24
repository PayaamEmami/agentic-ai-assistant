'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { type UploadedAttachment, useChatContext } from '@/lib/chat-context';
import { reportClientError } from '@/lib/client-logging';
import { useLiveVoiceSession } from '@/lib/use-live-voice-session';
import { ApprovalCard } from './approval-card';

const INDEXABLE_MIME_TYPES = new Set(['application/json', 'application/xml']);

function isIndexableDocument(file: File): boolean {
  return file.type.startsWith('text/') || INDEXABLE_MIME_TYPES.has(file.type);
}

function buildAttachmentFallbackMessage(attachments: UploadedAttachment[]): string {
  if (attachments.length === 1) {
    return `Attached ${attachments[0].kind}`;
  }

  return 'Attached files';
}

export function InputBar() {
  const {
    sendMessage,
    interruptMessage,
    uploadAttachment,
    startLiveVoiceSession,
    appendVoiceMessage,
    syncConversationState,
    subscribeToolEvents,
    pendingApprovals,
    loading,
  } = useChatContext();
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [focusRequestId, setFocusRequestId] = useState(0);

  const liveVoice = useLiveVoiceSession({
    startSession: startLiveVoiceSession,
    appendVoiceMessage,
    syncConversation: syncConversationState,
    subscribeToolEvents,
  });

  useEffect(() => {
    if (focusRequestId === 0 || liveVoice.isActive) {
      return;
    }
    const textarea = messageInputRef.current;
    textarea?.focus();
    if (textarea) {
      const value = textarea.value;
      textarea.setSelectionRange(value.length, value.length);
    }
  }, [focusRequestId, liveVoice.isActive]);

  useEffect(() => {
    const textarea = messageInputRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';

    const computedStyle = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 20;
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    const maxHeight = lineHeight * 5 + paddingTop + paddingBottom;

    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [message]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedMessage = message.trim();
    if (!trimmedMessage && attachments.length === 0) return;

    const nextMessage = trimmedMessage || buildAttachmentFallbackMessage(attachments);
    const nextAttachments = attachments;
    setMessage('');
    setAttachments([]);

    await sendMessage(nextMessage, nextAttachments);
  };

  const handleFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    for (const file of files) {
      try {
        const attachment = await uploadAttachment(file, {
          indexForRag: isIndexableDocument(file),
        });
        setAttachments((previous) => [...previous, attachment]);
      } catch (error) {
        void reportClientError({
          event: 'client.upload.failed',
          component: 'input-bar',
          message: 'Attachment upload failed',
          error,
          context: {
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          },
        });
      }
    }

    e.target.value = '';
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((previous) => previous.filter((attachment) => attachment.id !== attachmentId));
  };

  const voiceApprovalsByToolExecution = useMemo(() => {
    const pendingExecutionIds = new Set(
      liveVoice.pendingToolCalls
        .filter((call) => call.status === 'requires_approval')
        .map((call) => call.toolExecutionId),
    );
    return pendingApprovals.filter((approval) =>
      pendingExecutionIds.has(approval.toolExecutionId),
    );
  }, [liveVoice.pendingToolCalls, pendingApprovals]);

  const micDisabledReason = useMemo(() => {
    if (loading.isSendingMessage) {
      return 'End the current text response before starting voice.';
    }
    if (pendingApprovals.length > 0) {
      return 'Resolve pending approvals before starting voice.';
    }
    if (loading.isUploadingAttachment) {
      return 'Wait for attachment upload to finish before starting voice.';
    }
    return null;
  }, [loading.isSendingMessage, loading.isUploadingAttachment, pendingApprovals.length]);

  if (liveVoice.isActive) {
    return (
      <section className="border-t border-border bg-surface-elevated p-4">
        <div className="rounded-3xl border border-border bg-surface px-4 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Live Voice</p>
              <p className="mt-1 text-xs text-foreground-muted">{liveVoice.connectionLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const partial = liveVoice.userCaption.trim();
                  void liveVoice.stop();
                  if (partial) {
                    setMessage((current) => (current.trim().length > 0 ? current : partial));
                  }
                  setFocusRequestId((value) => value + 1);
                }}
                className="rounded-full border border-border bg-surface-input px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
              >
                Switch to text
              </button>
              <button
                type="button"
                onClick={() => void liveVoice.stop()}
                className="rounded-full border border-error/30 bg-error/10 px-4 py-2 text-xs font-medium text-error transition-colors hover:bg-error/20"
              >
                End voice mode
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-border-subtle bg-surface-input p-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground-inactive">
                You
              </p>
              <p className="mt-2 min-h-16 text-sm text-foreground">
                {liveVoice.userCaption || 'Start speaking and your live caption will appear here.'}
              </p>
            </div>

            <div className="rounded-2xl border border-border-subtle bg-surface-input p-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground-inactive">
                Assistant
              </p>
              <p className="mt-2 min-h-16 text-sm text-foreground">
                {liveVoice.assistantCaption ||
                  'The assistant will answer here in text while speaking back to you.'}
              </p>
            </div>
          </div>

          {voiceApprovalsByToolExecution.length > 0 ? (
            <div className="mt-4 space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground-inactive">
                Awaiting approval
              </p>
              {voiceApprovalsByToolExecution.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  id={approval.id}
                  description={approval.description}
                />
              ))}
            </div>
          ) : null}

          <p className="mt-3 text-[11px] text-foreground-inactive">
            Live voice can invoke tools. Sensitive tools will pause for approval here before
            running.
          </p>
          {liveVoice.error ? (
            <p className="mt-2 text-xs text-error">{liveVoice.error}</p>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-h-[75px] flex-col justify-center border-t border-border bg-surface-elevated p-4"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <span
              key={attachment.id}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-input px-3 py-1 text-xs text-foreground"
            >
              <span>{attachment.name}</span>
              {attachment.indexedForRag ? (
                <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-white">
                  Indexed
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                className="text-foreground-muted hover:text-foreground"
                aria-label={`Remove ${attachment.name}`}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={handleFilePicker}
          disabled={loading.isUploadingAttachment}
          className="rounded-lg p-2 text-foreground-muted hover:bg-surface-hover hover:text-foreground"
          title="Upload file"
        >
          <AttachmentIcon />
        </button>
        <button
          type="button"
          onClick={() => void liveVoice.toggle()}
          disabled={Boolean(micDisabledReason)}
          className="rounded-lg p-2 text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground-muted"
          title={micDisabledReason ?? 'Live voice mode'}
          aria-label={micDisabledReason ?? 'Live voice mode'}
        >
          <MicIcon />
        </button>
        <textarea
          ref={messageInputRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={1}
          placeholder="Type a message or attach files..."
          className="min-h-10 flex-1 resize-none rounded-lg border border-border-subtle bg-surface-input px-4 py-2 text-sm text-foreground placeholder:text-foreground-inactive focus:border-accent focus:outline-none"
        />
        {loading.isSendingMessage ? (
          <button
            type="button"
            onClick={() => void interruptMessage()}
            disabled={loading.isInterruptingMessage}
            className="rounded-lg border border-error/30 bg-error/10 p-2 text-error transition-colors hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-40"
            title={loading.isInterruptingMessage ? 'Stopping response...' : 'Stop response'}
            aria-label={loading.isInterruptingMessage ? 'Stopping response' : 'Stop response'}
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!message.trim() && attachments.length === 0}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
      {liveVoice.error ? <p className="mt-3 text-xs text-error">{liveVoice.error}</p> : null}
    </form>
  );
}

function AttachmentIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.44 11.05 12.25 20.24a6 6 0 1 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.48-8.48" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  );
}
