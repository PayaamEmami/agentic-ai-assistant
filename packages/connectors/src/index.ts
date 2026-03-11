export type {
  ConnectorKind,
  ConnectorAuth,
  ConnectorItem,
  SyncResult,
  Connector,
} from './types.js';

export { GitHubConnector } from './github.js';
export { GoogleDriveConnector } from './google-drive.js';
export { GoogleDocsConnector } from './google-docs.js';
export { ProtonConnector } from './proton.js';
export { createConnector } from './factory.js';
