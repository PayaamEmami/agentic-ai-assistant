export type {
  MemoryItem,
  MemoryKind,
  PersonalizationProfile,
  PreferenceEntry,
  ProfileUpdateInput,
} from './types.js';

export type { MemoryService } from './memory-service.js';
export { MemoryServiceImpl } from './memory-service.js';

export type { MemoryDbAdapter, MemoryRow, PreferenceRow } from './db-adapter.js';

export type { QueryExecutor } from './pg-adapter.js';
export { PgMemoryAdapter } from './pg-adapter.js';
