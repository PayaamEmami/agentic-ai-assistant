-- Idempotent local sample data for development login. Safe to run after every migrate.
INSERT INTO users (id, email, display_name, password_hash)
VALUES ('00000000-0000-4000-8000-000000000001', 'dev@localhost', 'Dev User', NULL)
ON CONFLICT (email) DO NOTHING;

INSERT INTO conversations (id, user_id, title, chat_model)
SELECT
  '00000000-0000-4000-8000-000000000010',
  id,
  'Welcome',
  'gpt-6-luna'
FROM users
WHERE email = 'dev@localhost'
ON CONFLICT (id) DO NOTHING;

INSERT INTO messages (id, conversation_id, role, content, created_at)
VALUES
  (
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000010',
    'user',
    '[{"type":"text","text":"What is this local workspace for?"}]'::jsonb,
    NOW() - INTERVAL '2 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000010',
    'assistant',
    '[{"type":"text","text":"This is sample data in your local database. Chat still uses the OpenAI key in .env. Connecting MCP, Google, or GitHub leaves this machine."}]'::jsonb,
    NOW() - INTERVAL '1 minute'
  )
ON CONFLICT (id) DO NOTHING;
