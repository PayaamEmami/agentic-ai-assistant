import type { DocumentInput, ChunkResult } from './types.js';

export interface ChunkingService {
  chunk(document: DocumentInput, chunkSize?: number, overlap?: number): Promise<ChunkResult[]>;
}

export class SimpleChunkingService implements ChunkingService {
  async chunk(_document: DocumentInput, _chunkSize = 512, _overlap = 64): Promise<ChunkResult[]> {
    // TODO: implement text splitting by token count with overlap
    return [];
  }
}
