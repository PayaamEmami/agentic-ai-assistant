import type { MemoryItemDto, MemoryKindType, PersonalizationProfileDto } from '@aaa/shared';
import { request } from './client';

export type PersonalizationMemoryKind = MemoryKindType;
export type PersonalizationProfile = PersonalizationProfileDto;
export type PersonalizationMemory = MemoryItemDto;

export const personalizationApi = {
  get() {
    return request<{
      profile: PersonalizationProfile;
      memories: PersonalizationMemory[];
    }>('/api/personalization');
  },
  updateProfile(input: { writingStyle?: string | null; tonePreference?: string | null }) {
    return request<{ profile: PersonalizationProfile }>('/api/personalization/profile', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },
  createMemory(input: { kind: PersonalizationMemoryKind; content: string }) {
    return request<{ memory: PersonalizationMemory }>('/api/personalization/memories', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  updateMemory(memoryId: string, input: { content: string }) {
    return request<{ memory: PersonalizationMemory }>(
      `/api/personalization/memories/${memoryId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    );
  },
  deleteMemory(memoryId: string) {
    return request<{ ok: boolean }>(`/api/personalization/memories/${memoryId}`, {
      method: 'DELETE',
    });
  },
};
