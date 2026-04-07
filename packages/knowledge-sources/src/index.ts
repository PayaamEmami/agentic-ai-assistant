export type {
  KnowledgeSourceKind,
  KnowledgeSourceAuth,
  KnowledgeSourceItem,
  KnowledgeSyncResult,
  KnowledgeSource,
} from './types.js';
export { encryptCredentials, decryptCredentials } from './credentials.js';

export { GitHubKnowledgeSource } from './github.js';
export { GoogleKnowledgeSource } from './google-docs.js';
export { createKnowledgeSource } from './factory.js';
