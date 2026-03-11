export interface MemoryItem {
  id: string;
  userId: string;
  kind: MemoryKind;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type MemoryKind = 'fact' | 'preference' | 'relationship' | 'project' | 'person' | 'instruction';

export interface PersonalizationProfile {
  userId: string;
  writingStyle: string | null;
  tonePreference: string | null;
  domainContext: string[];
  recentTopics: string[];
}

export interface PreferenceEntry {
  key: string;
  value: string;
  updatedAt: Date;
}
