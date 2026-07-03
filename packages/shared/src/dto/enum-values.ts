import { AppCapability, AppKind, AttachmentKind, MemoryKind, MessageRole } from '../enums.js';

// Zod-friendly tuples of enum values shared across the DTO modules. Kept in one
// place so every schema references the same source of truth.
export const AttachmentKindValues = [
  AttachmentKind.Image,
  AttachmentKind.Document,
  AttachmentKind.Audio,
  AttachmentKind.File,
] as const;

export const AppKindValues = [AppKind.GitHub, AppKind.Google] as const;

export const AppCapabilityValues = [AppCapability.Knowledge, AppCapability.Tools] as const;

export const MemoryKindValues = [
  MemoryKind.Fact,
  MemoryKind.Preference,
  MemoryKind.Relationship,
  MemoryKind.Project,
  MemoryKind.Person,
  MemoryKind.Instruction,
] as const;

export const MessageRoleValues = [
  MessageRole.User,
  MessageRole.Assistant,
  MessageRole.System,
  MessageRole.Tool,
] as const;
