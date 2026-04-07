import type { KnowledgeSource, KnowledgeSourceKind } from './types.js';
import { GitHubKnowledgeSource } from './github.js';
import { GoogleKnowledgeSource } from './google-docs.js';

const knowledgeSourceConstructors: Record<KnowledgeSourceKind, () => KnowledgeSource> = {
  github: () => new GitHubKnowledgeSource(),
  google: () => new GoogleKnowledgeSource(),
};

export function createKnowledgeSource(kind: KnowledgeSourceKind): KnowledgeSource {
  const ctor = knowledgeSourceConstructors[kind];
  if (!ctor) throw new Error(`Unknown knowledge source kind: ${kind}`);
  return ctor();
}
