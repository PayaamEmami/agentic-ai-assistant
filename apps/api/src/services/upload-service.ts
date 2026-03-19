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
import {
  DocumentReindexingServiceImpl,
  SimpleChunkingService,
  type EmbeddingService,
} from '@aaa/retrieval';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
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

class UploadEmbeddingService implements EmbeddingService {
  constructor(private readonly modelProvider: OpenAIProvider) {}

  async generateEmbeddings(chunks: Array<{ id: string; content: string }>) {
    if (chunks.length === 0) {
      return [];
    }

    const response = await this.modelProvider.embed({
      input: chunks.map((chunk) => chunk.content),
      model: process.env['OPENAI_EMBEDDING_MODEL'],
    });

    return chunks.map((chunk, index) => {
      const vector = response.embeddings[index];
      if (!vector) {
        throw new AppError(
          502,
          'Embedding generation failed for one or more chunks',
          'EMBEDDING_FAILED',
        );
      }

      return {
        chunkId: chunk.id,
        vector,
        model: response.model,
      };
    });
  }
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

    const reindexingService = new DocumentReindexingServiceImpl(
      new SimpleChunkingService(),
      new UploadEmbeddingService(this.modelProvider),
      async (documentId) => {
        const existingChunks = await chunkRepository.listByDocument(documentId);
        await embeddingRepository.deleteByChunkIds(existingChunks.map((chunk) => chunk.id));
        await chunkRepository.deleteByDocument(documentId);
      },
      async (chunk) => {
        await chunkRepository.createWithId(
          chunk.id,
          chunk.documentId,
          chunk.content,
          chunk.index,
          chunk.tokenCount,
          chunk.metadata,
        );
      },
      async (embedding) => {
        await embeddingRepository.create(embedding.chunkId, embedding.vector, embedding.model);
      },
    );

    await reindexingService.reindexDocument({
      id: document.id,
      sourceId: source.id,
      title: fileName,
      content: textContent,
      mimeType,
      metadata: {
        source: 'upload',
        fileName,
        attachmentId,
      },
    });

    const storedChunks = await chunkRepository.listByDocument(document.id);

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
