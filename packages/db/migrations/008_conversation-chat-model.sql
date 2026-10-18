-- Each thread remembers the chat model for its next turn. Existing rows,
-- including hidden automation conversations, keep the model they were
-- already using.

ALTER TABLE conversations
  ADD COLUMN chat_model TEXT NOT NULL DEFAULT 'gpt-5.6-luna';

ALTER TABLE conversations
  ADD CONSTRAINT conversations_chat_model_valid
    CHECK (chat_model IN ('gpt-5.6-luna', 'gpt-6.1-sol', 'gpt-6-luna'));
