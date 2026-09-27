'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, type McpConnectionStatus, type McpConnectionTest } from '@/lib/api-client';

function connectionLabel(connection: McpConnectionStatus): string {
  return connection.serverName?.trim() || connection.capability;
}

export function McpConnectionSection() {
  const toast = useToast();
  const [connections, setConnections] = useState<McpConnectionStatus[]>([]);
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<McpConnectionTest | null>(null);

  const reload = useCallback(async () => {
    const status = await api.automation.getMcpStatus();
    setConnections(status.connections);
  }, []);

  useEffect(() => {
    void reload()
      .catch(() => {
        setConnections([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [reload]);

  const connect = async () => {
    setBusy(true);
    try {
      const result = await api.automation.connectMcp(serverUrl.trim(), apiKey.trim());
      setTest(result);

      if (result.connected) {
        setApiKey('');
        setServerUrl('');
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

  const disconnect = async (connection: McpConnectionStatus) => {
    const label = connectionLabel(connection);
    if (!window.confirm(`Disconnect ${label}?`)) {
      return;
    }

    setBusy(true);
    try {
      await api.automation.disconnectMcp(connection.capability);
      setTest(null);
      await reload();
      toast.success(`Disconnected ${label}.`);
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
        Connect MCP servers so chat and scheduled prompts can use their tools. Each server keeps
        its own URL and API key.
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
                          {connectionLabel(connection)}
                        </p>
                        <Badge variant="success" className="font-normal">
                          Connected
                        </Badge>
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
                        onClick={() => void disconnect(connection)}
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
            <h3 className="text-sm font-medium text-foreground">Add a server</h3>
            <Field label="MCP server URL">
              <Input
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://example.lambda-url.on.aws/"
                autoComplete="off"
              />
            </Field>

            <Field label="API key">
              <Input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="API key"
                autoComplete="off"
              />
            </Field>

            <Button
              onClick={() => void connect()}
              disabled={busy || !serverUrl.trim() || !apiKey.trim()}
            >
              Connect
            </Button>
          </div>

          {test && !test.connected && test.error ? <Alert>{test.error}</Alert> : null}

          {test?.connected && test.tools.length > 0 ? (
            <div className="rounded-xl border border-border bg-surface-elevated p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                Available tools
                {test.serverName ? ` · ${test.serverName}` : ''}
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
