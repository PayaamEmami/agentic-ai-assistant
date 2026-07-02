import {
  getLogger,
  openAiDurationMs,
  openAiEstimatedCostUsd,
  openAiRequestCounter,
  openAiTokens,
} from '@aaa/observability';

type TokenType = 'prompt' | 'completion' | 'input';

/**
 * Records the Prometheus counters, duration histogram, and structured
 * success/failure logs shared by every OpenAI provider call. Instantiated per
 * request so callers only supply the operation-specific token/cost metrics and
 * log fields instead of repeating the metric label boilerplate.
 */
export class OpenAiCallTelemetry {
  private readonly logger = getLogger({ component: 'openai-provider', provider: 'openai' });
  private readonly startedAt = Date.now();

  constructor(
    private readonly operation: string,
    private readonly model: string,
  ) {}

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  recordTokens(tokenType: TokenType, amount: number): void {
    openAiTokens.inc(
      { operation: this.operation, model: this.model, token_type: tokenType },
      amount,
    );
  }

  recordCost(costUsd: number): void {
    openAiEstimatedCostUsd.inc({ operation: this.operation, model: this.model }, costUsd);
  }

  success(event: string, message: string, fields: Record<string, unknown> = {}): void {
    openAiRequestCounter.inc({ operation: this.operation, model: this.model, outcome: 'success' });
    openAiDurationMs.observe(
      { operation: this.operation, model: this.model, outcome: 'success' },
      this.elapsedMs,
    );
    this.logger.info(
      {
        event,
        outcome: 'success',
        model: this.model,
        durationMs: this.elapsedMs,
        ...fields,
      },
      message,
    );
  }

  failure(event: string, message: string, error: unknown): void {
    openAiRequestCounter.inc({ operation: this.operation, model: this.model, outcome: 'failure' });
    openAiDurationMs.observe(
      { operation: this.operation, model: this.model, outcome: 'failure' },
      this.elapsedMs,
    );
    this.logger.error(
      {
        event,
        outcome: 'failure',
        model: this.model,
        error,
      },
      message,
    );
  }
}
