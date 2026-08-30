-- At most one in-flight run may claim a given card for a user.
CREATE UNIQUE INDEX idx_automation_runs_active_card
  ON automation_runs (user_id, selected_card_id)
  WHERE selected_card_id IS NOT NULL AND status IN ('queued', 'running');
