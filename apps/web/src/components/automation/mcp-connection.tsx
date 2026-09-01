'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, type McpConnectionStatus, type McpConnectionTest } from '@/lib/api-client';

interface McpConnectionSectionProps {
  onTaskBoardConnectedChange: (connected: boolean) => void;
}

function isTaskBoardCapability(capability: string): boolean {
  return capability === 'task-board' || capability === 'tools';
}

function connectionLabel(capability: string): string {
  if (isTaskBoardCapability(capability)) {
    return 'Task board';
  }
  if (capability === 'crs') {
    return 'Content recommendations';
  }
  return capability;
}

export function McpConnectionSection({
  onTaskBoardConnectedChange,
}: McpConnectionSectionProps) {
  const toast = useToast();
  const [connections, setConnections] = useState<McpConnectionStatus[]>([]);
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<McpConnectionTest | null>(null);

  const applyConnections = useCallback(
    (next: McpConnectionStatus[]) => {
      setConnections(next);
      onTaskBoardConnectedChange(next.some((item) => isTaskBoardCapability(item.capability)));
    },
    [onTaskBoardConnectedChange],
  );

  const reload = useCallback(async () => {
    const status = await api.automation.getMcpStatus();
    applyConnections(status.connections);
  }, [applyConnections]);

  useEffect(() => {
    void reload()
      .catch(() => {
        applyConnections([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [applyConnections, reload]);

  const connect = async () => {
    setBusy(true);
    try {
      const result = await api.automation.connectMcp(serverUrl.trim(), apiKey.trim());
      setTest(result);

      if (result.connected) {
        setApiKey('');
        await reload();
        toast.success(
          `Connected to ${result.serverName ?? 'the MCP server'} (${result.tools.length} tools).`,
        );
      } else {
        toast.error(result.error ?? 'Could not reach the MCP server.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save the connection');
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (capability: string) => {
    setBusy(true);
    try {
      const result = await api.automation.testMcp(capability);
      setTest(result);
      if (result.connected) {
        toast.success(`${result.tools.length} tools available.`);
      } else {
        toast.error(result.error ?? 'The MCP server did not respond.');
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (capability: string) => {
    if (!window.confirm(`Disconnect ${connectionLabel(capability)}?`)) {
      return;
    }

    setBusy(true);
    try {
      await api.automation.disconnectMcp(capability);
      setTest(null);
      await reload();
      toast.success(`Disconnected ${connectionLabel(capability)}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-medium text-foreground">MCP servers</h2>
      </div>
      <p className="max-w-2xl text-sm text-foreground-muted">
        Connect the task board for scheduled coding jobs and CRS for feeds, sources, and votes.
        Each server keeps its own API key. Connecting CRS does not replace the task board.
      </p>

      {loading ? (
        <p className="text-sm text-foreground-muted">Loading connections...</p>
      ) : (
        <div className="space-y-4">
          {connections.length === 0 ? (
            <p className="text-sm text-foreground-muted">No MCP servers connected yet.</p>
          ) : (
            <div className="space-y-3">
              {connections.map((connection) => (
                <div
                  key={connection.capability}
                  className="rounded-xl border border-border bg-surface-elevated p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {connectionLabel(connection.capability)}
                        </p>
                        <Badge variant="success" className="font-normal">
                          Connected
                        </Badge>
                        {connection.serverName ? (
                          <Badge className="font-normal">{connection.serverName}</Badge>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-foreground-muted">{connection.serverUrl}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void runTest(connection.capability)}
                        disabled={busy}
                      >
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void disconnect(connection.capability)}
                        disabled={busy}
                      >
                        Disconnect
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Add or update a server</h3>
            <Field label="MCP server URL">
              <Input
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://example.lambda-url.us-west-2.on.aws/"
                autoComplete="off"
              />
            </Field>

            <Field label="Agent API key">
              <Input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="tak_... or cak_..."
                autoComplete="off"
              />
            </Field>

            <Button
              onClick={() => void connect()}
              disabled={busy || !serverUrl.trim() || !apiKey.trim()}
            >
              {connections.length > 0 ? 'Save connection' : 'Connect'}
            </Button>
          </div>

          {test && !test.connected && test.error ? <Alert>{test.error}</Alert> : null}

          {test?.connected && test.tools.length > 0 ? (
            <div className="rounded-xl border border-border bg-surface-elevated p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                Available tools
                {test.capability ? ` · ${connectionLabel(test.capability)}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {test.tools.map((tool) => (
                  <Badge key={tool} className="font-normal">
                    {tool}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
