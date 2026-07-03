import { z } from 'zod';
import { AttachmentKindValues } from './enum-values.js';

export const TextContentDto = z.object({
  type: z.literal('text'),
  text: z.string(),
});
export type TextContentDto = z.infer<typeof TextContentDto>;

export const AttachmentRefContentDto = z.object({
  type: z.literal('attachment_ref'),
  attachmentId: z.string().uuid().optional(),
  attachmentKind: z.enum(AttachmentKindValues).optional(),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  indexedForRag: z.boolean().optional(),
  documentId: z.string().uuid().nullable().optional(),
});
export type AttachmentRefContentDto = z.infer<typeof AttachmentRefContentDto>;

export const TranscriptContentDto = z.object({
  type: z.literal('transcript'),
  text: z.string(),
  durationMs: z.number().finite().optional(),
});
export type TranscriptContentDto = z.infer<typeof TranscriptContentDto>;

export const ToolResultContentDto = z.object({
  type: z.literal('tool_result'),
  toolExecutionId: z.string().uuid().optional(),
  toolName: z.string().optional(),
  status: z
    .enum(['planned', 'pending', 'approved', 'rejected', 'running', 'completed', 'failed'])
    .optional(),
  detail: z.string().optional(),
  output: z.unknown().optional(),
});
export type ToolResultContentDto = z.infer<typeof ToolResultContentDto>;

export const CitationContentDto = z.object({
  type: z.literal('citation'),
  sourceId: z.string().uuid().optional(),
  title: z.string().optional(),
  excerpt: z.string().optional(),
  uri: z.string().optional(),
});
export type CitationContentDto = z.infer<typeof CitationContentDto>;

export const StatusContentDto = z.object({
  type: z.literal('status'),
  status: z.literal('interrupted'),
  label: z.string().optional(),
});
export type StatusContentDto = z.infer<typeof StatusContentDto>;

export const ThinkingContentDto = z.object({
  type: z.literal('thinking'),
  segments: z.array(
    z.object({
      stage: z.string(),
      text: z.string(),
    }),
  ),
});
export type ThinkingContentDto = z.infer<typeof ThinkingContentDto>;

export const MessageContentDto = z.discriminatedUnion('type', [
  TextContentDto,
  AttachmentRefContentDto,
  TranscriptContentDto,
  ToolResultContentDto,
  CitationContentDto,
  StatusContentDto,
  ThinkingContentDto,
]);
export type MessageContentDto = z.infer<typeof MessageContentDto>;
