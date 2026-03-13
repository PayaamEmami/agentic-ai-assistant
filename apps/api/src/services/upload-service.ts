import type { MultipartFile } from '@fastify/multipart';
import { OpenAIProvider } from '@aaa/ai';
import {
  attachmentRepository,
  chunkRepository,
  documentRepository,
  embeddingRepository,
  getPool,
  sourceRepository,
} from '@aaa/db';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_CHUNK_TOKEN_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP_TOKENS = 64;
const TOKEN_MULTIPLIER = 1.3;
const EXTRACTABLE_TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/xml',
]);

function determineAttachmentKind(mimeType: string): 'image' | 'document' | 'audio' | 'file' {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  if (mimeType.startsWith('audio/')) {
    return 'audio';
  }

  if (isExtractableTextMimeType(mimeType)) {
    return 'document';
  }

  return 'file';
}

function isExtractableTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith('text/') || EXTRACTABLE_TEXT_MIME_TYPES.has(mimeType);
}

function extractTextContent(mimeType: string, buffer: Buffer): string | null {
  if (!isExtractableTextMimeType(mimeType)) {
    return null;
  }

  const text = buffer.toString('utf8').trim();
  return text.length > 0 ? text : null;
}

interface ChunkCandidate {
  content: string;
  tokenCount: number;
  index: number;
}

function tokenizeWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function estimateTokenCount(text: string): number {
  const wordCount = tokenizeWords(text).length;
  return wordCount === 0 ? 0 : Math.ceil(wordCount * TOKEN_MULTIPLIER);
}

function buildChunkWithOverlap(
  previousChunk: string,
  nextParagraph: string,
  overlapTokens: number,
  chunkSize: number,
): string {
  if (overlapTokens <= 0) {
    return nextParagraph;
  }

  const previousWords = tokenizeWords(previousChunk);
  if (previousWords.length === 0) {
    return nextParagraph;
  }

  let wordsToTake = Math.min(previousWords.length, Math.ceil(overlapTokens / TOKEN_MULTIPLIER));

  while (wordsToTake > 0) {
    const overlapText = previousWords.slice(-wordsToTake).join(' ');
    const candidate = `${overlapText}\n\n${nextParagraph}`;
    if (estimateTokenCount(candidate) <= chunkSize) {
      return candidate;
    }
    wordsToTake -= 1;
  }

  return nextParagraph;
}

function chunkTextContent(content: string): ChunkCandidate[] {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    return [];
  }

  const paragraphs = normalizedContent
    .split(/\r?\n\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return [];
  }

  const chunkContents: string[] = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if (!currentChunk) {
      currentChunk = paragraph;
      continue;
    }

    const candidate = `${currentChunk}\n\n${paragraph}`;
    if (estimateTokenCount(candidate) <= DEFAULT_CHUNK_TOKEN_SIZE) {
      currentChunk = candidate;
      continue;
    }

    chunkContents.push(currentChunk);
    currentChunk = buildChunkWithOverlap(
      currentChunk,
      paragraph,
      DEFAULT_CHUNK_OVERLAP_TOKENS,
      DEFAULT_CHUNK_TOKEN_SIZE,
    );
  }

  if (currentChunk) {
    chunkContents.push(currentChunk);
  }

  return chunkContents.map((chunk, index) => ({
    content: chunk,
    tokenCount: estimateTokenCount(chunk),
    index,
  }));
}

export class UploadService {
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

  private async indexAttachmentForRetrieval(
    userId: string,
    attachmentId: string,
    fileName: string,
    mimeType: string,
    textContent: string,
  ): Promise<string> {
    const source = await sourceRepository.create(
      userId,
      'document',
      null,
      null,
      fileName,
      null,
    );

    const document = await documentRepository.create(
      userId,
      source.id,
      fileName,
      textContent,
      mimeType,
    );

    const chunks = chunkTextContent(textContent);
    const storedChunks = await Promise.all(
      chunks.map((chunk) =>
        chunkRepository.create(
          document.id,
          chunk.content,
          chunk.index,
          chunk.tokenCount,
          { source: 'upload', fileName, attachmentId },
        ),
      ),
    );

    if (storedChunks.length > 0) {
      const embeddings = await this.modelProvider.embed({
        input: storedChunks.map((chunk) => chunk.content),
        model: process.env['OPENAI_EMBEDDING_MODEL'],
      });

      await Promise.all(
        storedChunks.map(async (chunk, index) => {
          const vector = embeddings.embeddings[index];
          if (!vector) {
            throw new AppError(
              502,
              'Embedding generation failed for one or more chunks',
              'EMBEDDING_FAILED',
            );
          }
          await embeddingRepository.create(chunk.id, vector, embeddings.model);
        }),
      );
    }

    await attachmentRepository.setDocument(attachmentId, document.id, userId);

    logger.info(
      {
        userId,
        attachmentId,
        documentId: document.id,
        sourceId: source.id,
        chunkCount: storedChunks.length,
      },
      'Attachment indexed for retrieval',
    );

    return document.id;
  }

  async handleUpload(userId: string, file: MultipartFile, options?: { indexForRag?: boolean }) {
    getPool();

    logger.info(
      { fileName: file.filename, mimeType: file.mimetype, userId, indexForRag: options?.indexForRag ?? false },
      'Processing upload',
    );

    const buffer = await file.toBuffer();
    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new AppError(413, 'File is too large', 'FILE_TOO_LARGE');
    }
    if (buffer.byteLength === 0) {
      throw new AppError(400, 'Uploaded file is empty', 'EMPTY_FILE');
    }

    const fileName = file.filename || 'upload';
    const mimeType = file.mimetype || 'application/octet-stream';
    const attachmentKind = determineAttachmentKind(mimeType);
    const textContent = extractTextContent(mimeType, buffer);

    if (options?.indexForRag && !textContent) {
      throw new AppError(
        415,
        `RAG indexing is currently supported for text-based files only. Received ${mimeType}.`,
        'UNSUPPORTED_RAG_FILE_TYPE',
      );
    }
    const attachment = await attachmentRepository.create(
      userId,
      attachmentKind,
      fileName,
      mimeType,
      buffer.byteLength,
      buffer,
      textContent,
    );

    let documentId: string | null = null;
    if (options?.indexForRag && textContent) {
      documentId = await this.indexAttachmentForRetrieval(
        userId,
        attachment.id,
        fileName,
        mimeType,
        textContent,
      );
    }

    return {
      attachmentId: attachment.id,
      fileName,
      mimeType,
      sizeBytes: buffer.byteLength,
      kind: attachment.kind,
      indexedForRag: documentId !== null,
      documentId,
    };
  }
}
