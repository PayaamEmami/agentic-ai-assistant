import { z } from 'zod';
import { MemoryKindValues } from './enum-values.js';

export const MemoryKindDto = z.enum(MemoryKindValues);
export type MemoryKindDto = z.infer<typeof MemoryKindDto>;

export const PersonalizationProfileDto = z.object({
  writingStyle: z.string().nullable(),
  tonePreference: z.string().nullable(),
});
export type PersonalizationProfileDto = z.infer<typeof PersonalizationProfileDto>;

export const MemoryItemDto = z.object({
  id: z.string().uuid(),
  kind: MemoryKindDto,
  content: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MemoryItemDto = z.infer<typeof MemoryItemDto>;

export const PersonalizationResponse = z.object({
  profile: PersonalizationProfileDto,
  memories: z.array(MemoryItemDto),
});
export type PersonalizationResponse = z.infer<typeof PersonalizationResponse>;

export const UpdatePersonalizationProfileRequest = z.object({
  writingStyle: z.string().max(500).nullable().optional(),
  tonePreference: z.string().max(500).nullable().optional(),
});
export type UpdatePersonalizationProfileRequest = z.infer<
  typeof UpdatePersonalizationProfileRequest
>;

export const CreateMemoryRequest = z.object({
  kind: MemoryKindDto,
  content: z.string().trim().min(1).max(2000),
});
export type CreateMemoryRequest = z.infer<typeof CreateMemoryRequest>;

export const UpdateMemoryRequest = z.object({
  content: z.string().trim().min(1).max(2000),
});
export type UpdateMemoryRequest = z.infer<typeof UpdateMemoryRequest>;

export const MemoryMutationResponse = z.object({
  memory: MemoryItemDto,
});
export type MemoryMutationResponse = z.infer<typeof MemoryMutationResponse>;

export const DeleteMemoryResponse = z.object({
  ok: z.literal(true),
});
export type DeleteMemoryResponse = z.infer<typeof DeleteMemoryResponse>;
