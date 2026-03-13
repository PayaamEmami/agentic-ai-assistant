'use client';

import { useEffect, useRef, useState } from 'react';
import { type UploadedAttachment, useChatContext } from '@/lib/chat-context';
import { api } from '@/lib/api-client';

const INDEXABLE_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
]);

function isIndexableDocument(file: File): boolean {
  return file.type.startsWith('text/') || INDEXABLE_MIME_TYPES.has(file.type);
}

function buildAttachmentFallbackMessage(attachments: UploadedAttachment[]): string {
  if (attachments.length === 1) {
    return `Attached ${attachments[0].kind}`;
  }

  return 'Attached files';
}

const RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function getSupportedRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') {
    return undefined;
  }

  return RECORDING_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function buildVoiceFile(blob: Blob): File {
  const mimeType = blob.type || 'audio/webm';
  const extension =
    mimeType.includes('mp4')
      ? 'm4a'
      : mimeType.includes('ogg')
        ? 'ogg'
        : mimeType.includes('wav')
          ? 'wav'
          : 'webm';

  return new File([blob], `voice-message.${extension}`, { type: mimeType });
}

export function InputBar() {
  const { sendMessage, uploadAttachment, sendVoiceMessage, loading } = useChatContext();
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [indexDocuments, setIndexDocuments] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const stopAudioPlayback = () => {
    audioRef.current?.pause();
    audioRef.current = null;

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  };

  const releaseMicrophone = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const playAssistantReply = async (blob: Blob) => {
    stopAudioPlayback();

    const audioUrl = URL.createObjectURL(blob);
    audioUrlRef.current = audioUrl;

    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    audio.onended = () => {
      if (audioUrlRef.current === audioUrl) {
        URL.revokeObjectURL(audioUrl);
        audioUrlRef.current = null;
      }
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
      setVoiceStatus(null);
    };

    audio.onerror = () => {
      if (audioUrlRef.current === audioUrl) {
        URL.revokeObjectURL(audioUrl);
        audioUrlRef.current = null;
      }
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
      setVoiceStatus('Assistant reply is ready, but audio playback failed.');
    };

    try {
      await audio.play();
    } catch (error) {
      stopAudioPlayback();
      throw error;
    }
  };

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      releaseMicrophone();
      stopAudioPlayback();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedMessage = message.trim();
    if (!trimmedMessage && attachments.length === 0) return;

    await sendMessage(trimmedMessage || buildAttachmentFallbackMessage(attachments), attachments);

    setMessage('');
    setAttachments([]);
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
          indexForRag: indexDocuments && isIndexableDocument(file),
        });
        setAttachments((previous) => [...previous, attachment]);
      } catch (error) {
        console.error('Attachment upload failed', error);
      }
    }

    e.target.value = '';
  };

  const handleVoiceMode = async () => {
    if (isRecording) {
      setVoiceStatus('Processing your voice message...');
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    if (
      typeof window === 'undefined' ||
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setVoiceStatus('Voice recording is not supported in this browser.');
      return;
    }

    try {
      stopAudioPlayback();
      setVoiceStatus('Listening...');

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      audioChunksRef.current = [];
      const mimeType = getSupportedRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        const recordedBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || mimeType || 'audio/webm',
        });

        audioChunksRef.current = [];
        mediaRecorderRef.current = null;
        releaseMicrophone();

        void (async () => {
          if (recordedBlob.size === 0) {
            setVoiceStatus('No audio was captured. Please try again.');
            return;
          }

          setIsProcessingVoice(true);
          try {
            const voiceFile = buildVoiceFile(recordedBlob);
            const { assistantText } = await sendVoiceMessage(voiceFile);
            setVoiceStatus('Playing assistant response...');
            const speech = await api.voice.synthesize(assistantText);
            await playAssistantReply(speech);
          } catch (error) {
            setVoiceStatus(
              error instanceof Error ? error.message : 'Voice mode failed. Please try again.',
            );
          } finally {
            setIsProcessingVoice(false);
          }
        })();
      });

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (error) {
      releaseMicrophone();
      setIsRecording(false);
      setVoiceStatus(
        error instanceof Error ? error.message : 'Microphone access failed.',
      );
    }
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((previous) => previous.filter((attachment) => attachment.id !== attachmentId));
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-200 bg-white p-4">
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
              className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-xs text-gray-700"
            >
              <span>{attachment.name}</span>
              {attachment.indexedForRag ? (
                <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-medium text-white">
                  Indexed
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                className="text-gray-400 hover:text-gray-700"
                aria-label={`Remove ${attachment.name}`}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleFilePicker}
          disabled={loading.isUploadingAttachment}
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          title="Upload file"
        >
          <AttachmentIcon />
        </button>
        <button
          type="button"
          onClick={handleVoiceMode}
          disabled={!isRecording && (loading.isSendingMessage || isProcessingVoice)}
          className={`rounded-lg p-2 transition-colors ${
            isRecording
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
          }`}
          title={isRecording ? 'Stop recording' : 'Voice mode'}
        >
          <MicIcon />
        </button>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message or attach files..."
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-gray-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading.isSendingMessage || (!message.trim() && attachments.length === 0)}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading.isSendingMessage ? 'Sending...' : 'Send'}
        </button>
      </div>
      {voiceStatus ? (
        <p className="mt-3 text-xs text-gray-600">{voiceStatus}</p>
      ) : null}
      <label className="mt-3 flex items-center gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={indexDocuments}
          onChange={(e) => setIndexDocuments(e.target.checked)}
          className="rounded border-gray-300 text-gray-900 focus:ring-gray-500"
        />
        Index text documents for RAG when possible
      </label>
      <p className="mt-2 text-[11px] text-gray-500">
        Voice replies are AI-generated.
      </p>
    </form>
  );
}

function AttachmentIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05 12.25 20.24a6 6 0 1 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.48-8.48" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}
