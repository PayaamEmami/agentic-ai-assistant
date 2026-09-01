-- Multiple MCP servers per user: capability is a slug for app_kind=mcp
-- (task-board, crs, …) while GitHub/Google stay on knowledge/tools.

ALTER TABLE app_capability_configs
  DROP CONSTRAINT app_capability_configs_capability_valid;

ALTER TABLE app_capability_configs
  ADD CONSTRAINT app_capability_configs_capability_valid
    CHECK (
      (app_kind IN ('github', 'google') AND capability IN ('knowledge', 'tools'))
      OR (app_kind = 'mcp' AND capability ~ '^[a-z][a-z0-9-]{0,63}$')
    );

UPDATE app_capability_configs
SET capability = 'task-board',
    updated_at = NOW()
WHERE app_kind = 'mcp'
  AND capability = 'tools';
