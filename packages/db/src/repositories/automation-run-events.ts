import crypto from 'node:crypto';
import { getPool } from '../client.js';
import { isPgUniqueViolation } from '../errors.js';

export type AutomationRunEventKind = 'stage' | 'thought' | 'progress' | 'result';

export interface AutomationRunEvent {
  id: string;
  runId: string;
  seq: number;
  at: Date;
  kind: AutomationRunEventKind;
  stage: string | null;
  phase: string | null;
  message: string;
}

export interface AutomationRunEventInput {
  runId: string;
  kind: AutomationRunEventKind;
  message: string;
  stage?: string | null;
  phase?: string | null;
}

export interface AutomationRunEventRepository {
  append(input: AutomationRunEventInput): Promise<AutomationRunEvent>;
  listByRun(runId: string, afterSeq?: number): Promise<AutomationRunEvent[]>;
}

const SELECT_FIELDS = `id,
                       run_id AS "runId",
                       seq,
                       at,
                       kind,
                       stage,
                       phase,
                       message`;

const APPEND_ATTEMPTS = 5;

export const automationRunEventRepository: AutomationRunEventRepository = {
  /**
   * Appends one entry to a run's activity log.
   *
   * `seq` is assigned with a scalar subquery so the first event of a run still
   * inserts (an `INSERT … SELECT … FROM automation_run_events` would insert
   * zero rows when the log is empty). Concurrent appends retry on the unique
   * (run_id, seq) constraint.
   */
  async append(input: AutomationRunEventInput): Promise<AutomationRunEvent> {
    const pool = getPool();

    for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt += 1) {
      try {
        const result = await pool.query<AutomationRunEvent>(
          `INSERT INTO automation_run_events (id, run_id, seq, kind, stage, phase, message)
           VALUES (
             $1,
             $2,
             (SELECT COALESCE(MAX(seq), 0) + 1 FROM automation_run_events WHERE run_id = $2),
             $3,
             $4,
             $5,
             $6
           )
           RETURNING ${SELECT_FIELDS}`,
          [
            crypto.randomUUID(),
            input.runId,
            input.kind,
            input.stage ?? null,
            input.phase ?? null,
            input.message,
          ],
        );
        const row = result.rows[0];
        if (!row) {
          throw new Error('Failed to append automation run event');
        }
        return row;
      } catch (error) {
        if (!isPgUniqueViolation(error) || attempt === APPEND_ATTEMPTS - 1) {
          throw error;
        }
      }
    }

    throw new Error('Failed to append automation run event');
  },

  /** Ordered replay of a run's log; `afterSeq` supports incremental catch-up. */
  async listByRun(runId: string, afterSeq = 0): Promise<AutomationRunEvent[]> {
    const pool = getPool();
    const result = await pool.query<AutomationRunEvent>(
      `SELECT ${SELECT_FIELDS} FROM automation_run_events
       WHERE run_id = $1 AND seq > $2
       ORDER BY seq ASC`,
      [runId, afterSeq],
    );
    return result.rows;
  },
};
