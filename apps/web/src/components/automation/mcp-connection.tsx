'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, type McpConnectionTest } from '@/lib/api-client';

interface McpConnectionSectionProps {
  onConnectedChange: (connected: boolean) => void;
}

export function McpConnectionSection({ onConnectedChange }: McpConnectionSectionProps) {
  const toast = useToast();
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<McpConnectionTest | null>(null);

  const applyConnected = useCallback(
    (value: boolean) => {
      setConnected(value);
      onConnectedChange(value);
    },
    [onConnectedChange],
  );

  useEffect(() => {
    void api.automation
      .getMcpStatus()
      .then((status) => {
        applyConnected(status.connected);
        setServerUrl(status.serverUrl ?? '');
      })
      .catch(() => {
        applyConnected(false);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [applyConnected]);

  const connect = async () => {
    setBusy(true);
    try {
      const result = await api.automation.connectMcp(serverUrl.trim(), apiKey.trim());
      setTest(result);
      applyConnected(result.connected);

      if (result.connected) {
        // The key is write-only from here on; clearing it avoids implying the
        // stored value is being displayed back.
        setApiKey('');
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

  const runTest = async () => {
    setBusy(true);
    try {
      const result = await api.automation.testMcp();
      setTest(result);
      applyConnected(result.connected);
      if (result.connected) {
        toast.success(`${result.tools.length} tools available.`);
      } else {
        toast.error(result.error ?? 'The MCP server did not respond.');
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect the task board MCP server?')) {
      return;
    }

    setBusy(true);
    try {
      await api.automation.disconnectMcp();
      applyConnected(false);
      setTest(null);
      setServerUrl('');
      setApiKey('');
      toast.success('Disconnected the MCP server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-medium text-foreground">Task board connection</h2>
        <Badge variant={connected ? 'success' : 'neutral'} className="font-normal">
          {connected ? 'Connected' : 'Not connected'}
        </Badge>
      </div>
      <p className="max-w-2xl text-sm text-foreground-muted">
        Point the assistant at your task board&apos;s MCP server. The API key is stored encrypted
        and is only used for the board tools it was scoped to.
      </p>

      {loading ? (
        <p className="text-sm text-foreground-muted">Loading connection...</p>
      ) : (
        <div className="space-y-4">
          <Field label="MCP server URL">
            <Input
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="https://example.lambda-url.us-east-1.on.aws/"
              autoComplete="off"
            />
          </Field>

          <Field label="Agent API key">
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={connected ? 'Stored — enter a new key to replace it' : 'tak_...'}
              autoComplete="off"
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void connect()}
              disabled={busy || !serverUrl.trim() || !apiKey.trim()}
            >
              {connected ? 'Update connection' : 'Connect'}
            </Button>
            {connected ? (
              <Button variant="secondary" onClick={() => void runTest()} disabled={busy}>
                Test connection
              </Button>
            ) : null}
            {connected ? (
              <Button variant="danger" onClick={() => void disconnect()} disabled={busy}>
                Disconnect
              </Button>
            ) : null}
          </div>

          {test && !test.connected && test.error ? <Alert>{test.error}</Alert> : null}

          {test?.connected && test.tools.length > 0 ? (
            <div className="rounded-xl border border-border bg-surface-elevated p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                Available tools
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
