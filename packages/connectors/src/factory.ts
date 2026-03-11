import type { Connector, ConnectorKind } from './types.js';
import { GitHubConnector } from './github.js';
import { GoogleDriveConnector } from './google-drive.js';
import { GoogleDocsConnector } from './google-docs.js';
import { ProtonConnector } from './proton.js';

const connectorConstructors: Record<ConnectorKind, () => Connector> = {
  github: () => new GitHubConnector(),
  google_drive: () => new GoogleDriveConnector(),
  google_docs: () => new GoogleDocsConnector(),
  proton_mail: () => new ProtonConnector(),
};

export function createConnector(kind: ConnectorKind): Connector {
  const ctor = connectorConstructors[kind];
  if (!ctor) throw new Error(`Unknown connector kind: ${kind}`);
  return ctor();
}
