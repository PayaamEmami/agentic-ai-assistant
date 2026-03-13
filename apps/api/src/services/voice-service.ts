import crypto from 'node:crypto';
import type { MultipartFile } from '@fastify/multipart';
import { OpenAIProvider } from '@aaa/ai';
import { conversationRepository, getPool } from '@aaa/db';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export class VoiceService {
  private readonly modelProvider: OpenAIProvider;

  constructor(modelProvider?: OpenAIProvider) {
    this.modelProvider =
      modelProvider ??
      new OpenAIProvider(
        process.env['OPENAI_API_KEY'] ?? '',
        process.env['OPENAI_MODEL'],
        process.env['OPENAI_EMBEDDING_MODEL'],
      );
  }

  async createSession(userId: string, conversationId?: string) {
    getPool();

    const conversation =
      conversationId === undefined
        ? await conversationRepository.create(userId)
        : await conversationRepository.findById(conversationId);

    if (!conversation || conversation.userId !== userId) {
      throw new AppError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    logger.info({ userId, conversationId: conversation.id }, 'Creating voice session');

    return {
      sessionId: crypto.randomUUID(),
      ephemeralToken: `dev-${crypto.randomUUID()}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      conversationId: conversation.id,
    };
  }

  async transcribeAudio(userId: string, file: MultipartFile): Promise<string> {
    const buffer = await file.toBuffer();
    if (buffer.byteLength === 0) {
      throw new AppError(400, 'Uploaded audio is empty', 'EMPTY_AUDIO');
    }

    const transcription = await this.modelProvider.transcribeAudio({
      audio: buffer,
      fileName: file.filename || 'voice-message.webm',
      mimeType: file.mimetype || 'application/octet-stream',
      model: process.env['OPENAI_TRANSCRIPTION_MODEL'],
    });

    const transcript = transcription.text.trim();
    if (!transcript) {
      throw new AppError(422, 'No speech was detected in the audio', 'EMPTY_TRANSCRIPT');
    }

    logger.info(
      {
        userId,
        fileName: file.filename,
        mimeType: file.mimetype,
        transcriptLength: transcript.length,
      },
      'Transcribed voice input',
    );

    return transcript;
  }

  async synthesizeSpeech(text: string): Promise<{ audio: Buffer; contentType: string }> {
    const trimmedText = text.trim();
    if (!trimmedText) {
      throw new AppError(400, 'Speech text is required', 'EMPTY_SPEECH_TEXT');
    }

    return this.modelProvider.synthesizeSpeech({
      input: trimmedText,
      model: process.env['OPENAI_TTS_MODEL'],
      voice: process.env['OPENAI_TTS_VOICE'],
      format: 'mp3',
    });
  }
}
