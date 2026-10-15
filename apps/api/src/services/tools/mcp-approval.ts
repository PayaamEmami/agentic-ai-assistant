const READ_ONLY_ACTION_VERBS = new Set([
  'list',
  'get',
  'read',
  'search',
  'find',
  'fetch',
  'lookup',
  'describe',
  'count',
  'status',
  'now',
  'today',
]);

const MUTATING_ACTION_VERBS = new Set([
  'create',
  'update',
  'delete',
  'remove',
  'replace',
  'write',
  'set',
  'add',
  'ingest',
  'send',
  'post',
  'put',
  'patch',
  'move',
  'rename',
  'execute',
  'run',
  'start',
  'stop',
  'cancel',
]);

/**
 * A remote tool that changes state needs approval in interactive chat. Read-only
 * tools do not, so browsing boards and feeds stays frictionless.
 *
 * Remote names are `{prefix}_{action}_...`. The first action token must be a
 * known read-only verb, and no later token may be a mutating verb — otherwise
 * names like `search_replace` or `get_or_create` would skip approval.
 */
export function mcpToolRequiresApproval(toolName: string): boolean {
  const parts = toolName.toLowerCase().split('_').filter(Boolean);
  const actionParts = parts.length > 1 ? parts.slice(1) : parts;
  const actionVerb = actionParts[0];
  if (!actionVerb) {
    return true;
  }

  if (actionParts.some((part) => MUTATING_ACTION_VERBS.has(part))) {
    return true;
  }

  return !READ_ONLY_ACTION_VERBS.has(actionVerb);
}
