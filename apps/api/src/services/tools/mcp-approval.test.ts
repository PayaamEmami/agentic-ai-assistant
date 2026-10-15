import { describe, expect, it } from 'vitest';
import { mcpToolRequiresApproval } from './mcp-approval.js';

describe('mcpToolRequiresApproval', () => {
  it('skips approval for read-only action verbs', () => {
    expect(mcpToolRequiresApproval('tasks_list_boards')).toBe(false);
    expect(mcpToolRequiresApproval('crs_get_feed')).toBe(false);
    expect(mcpToolRequiresApproval('docs_read_page')).toBe(false);
    expect(mcpToolRequiresApproval('finances_search_transactions')).toBe(false);
    expect(mcpToolRequiresApproval('wotd_today')).toBe(false);
  });

  it('requires approval for unknown or mutating actions', () => {
    expect(mcpToolRequiresApproval('tasks_create_card')).toBe(true);
    expect(mcpToolRequiresApproval('crs_ingest_source')).toBe(true);
    expect(mcpToolRequiresApproval('docs_search_replace')).toBe(true);
    expect(mcpToolRequiresApproval('tasks_get_or_create_card')).toBe(true);
    expect(mcpToolRequiresApproval('crs_search_and_delete')).toBe(true);
    expect(mcpToolRequiresApproval('unknown')).toBe(true);
  });
});
