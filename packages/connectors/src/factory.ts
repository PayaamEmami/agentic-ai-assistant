import type { Connector, ConnectorKind } from './types.js';
import { GitHubConnector } from './github.js';
import { GoogleDocsConnector } from './google-docs.js';

const connectorConstructors: Record<ConnectorKind, () => Connector> = {
  github: () => new GitHubConnector(),
  google_docs: () => new GoogleDocsConnector(),
};

export function createConnector(kind: ConnectorKind): Connector {
  const ctor = connectorConstructors[kind];
  if (!ctor) throw new Error(`Unknown connector kind: ${kind}`);
  return ctor();
}
