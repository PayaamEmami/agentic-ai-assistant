import type { MultipartFile } from '@fastify/multipart';
import { OpenAIProvider } from '@aaa/ai';
import {
  chunkRepository,
  documentRepository,
  embeddingRepository,
  getPool,
  sourceRepository,
} from '@aaa/db';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const DEFAULT_CHUNK_TOKEN_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP_TOKENS = 64;
const TOKEN_MULTIPLIER = 1.3;
const SUPPORTED_TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/json',
]);

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

  async handleUpload(userId: string, file: MultipartFile) {
    getPool();

    logger.info(
      { fileName: file.filename, mimeType: file.mimetype, userId },
      'Processing upload',
    );

    const buffer = await file.toBuffer();
    if (buffer.byteLength > MAX_TEXT_BYTES) {
      throw new AppError(413, 'File is too large', 'FILE_TOO_LARGE');
    }

    if (!SUPPORTED_TEXT_MIME_TYPES.has(file.mimetype)) {
      throw new AppError(
        415,
        `Unsupported file type: ${file.mimetype}. Supported types: ${Array.from(SUPPORTED_TEXT_MIME_TYPES).join(', ')}`,
        'UNSUPPORTED_FILE_TYPE',
      );
    }

    const textContent = buffer.toString('utf8').trim();
    if (!textContent) {
      throw new AppError(400, 'Uploaded file is empty', 'EMPTY_FILE');
    }

    const source = await sourceRepository.create(
      userId,
      'document',
      null,
      null,
      file.filename || 'upload',
      null,
    );

    const document = await documentRepository.create(
      userId,
      source.id,
      file.filename || 'upload',
      textContent,
      file.mimetype,
    );

    const chunks = chunkTextContent(textContent);
    const storedChunks = await Promise.all(
      chunks.map((chunk) =>
        chunkRepository.create(
          document.id,
          chunk.content,
          chunk.index,
          chunk.tokenCount,
          { source: 'upload', fileName: file.filename },
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
            throw new AppError(502, 'Embedding generation failed for one or more chunks', 'EMBEDDING_FAILED');
          }
          await embeddingRepository.create(chunk.id, vector, embeddings.model);
        }),
      );
    }

    logger.info(
      {
        userId,
        documentId: document.id,
        sourceId: source.id,
        chunkCount: storedChunks.length,
      },
      'Upload indexed for retrieval',
    );

    return {
      attachmentId: document.id,
      fileName: file.filename,
      mimeType: file.mimetype,
      sizeBytes: buffer.byteLength,
    };
  }
}
