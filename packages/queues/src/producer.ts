import { Queue } from 'bullmq';
import type { ConnectionOptions, JobsOptions } from 'bullmq';
import { getLogContext, getLogger, withSpan } from '@aaa/observability';

type SpanAttributes = Record<string, boolean | number | string | undefined>;
type LogValues = Record<string, unknown>;

export interface QueueProducer<TJobData extends { correlationId: string }> {
  enqueue(job: TJobData): Promise<void>;
  close(): Promise<void>;
}

export interface QueueProducerConfig<TJobData extends { correlationId: string }> {
  queueName: string;
  jobName: string;
  component: string;
  spanName: string;
  connection: ConnectionOptions;
  jobOptions?: JobsOptions;
  fallbackCorrelationId(job: TJobData): string;
  jobId?: (job: TJobData) => string | undefined;
  spanAttributes?: (job: TJobData) => SpanAttributes;
  log?: {
    message: string;
    event: string;
    context?: (job: TJobData, correlationId: string) => LogValues;
    fields?: (job: TJobData) => LogValues;
  };
}

function compactSpanAttributes(attributes: SpanAttributes): Record<string, boolean | number | string> {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      (entry): entry is [string, boolean | number | string] => entry[1] !== undefined,
    ),
  );
}

export function createQueueProducer<TJobData extends { correlationId: string }>({
  queueName,
  jobName,
  component,
  spanName,
  connection,
  jobOptions,
  fallbackCorrelationId,
  jobId,
  spanAttributes,
  log,
}: QueueProducerConfig<TJobData>): QueueProducer<TJobData> {
  let queue: Queue<TJobData, unknown, string> | null = null;

  function getQueue(): Queue<TJobData, unknown, string> {
    if (!queue) {
      queue = new Queue<TJobData, unknown, string>(queueName, { connection });
    }
    return queue;
  }

  return {
    async enqueue(job) {
      const correlationId =
        job.correlationId || getLogContext().correlationId || fallbackCorrelationId(job);
      const payload = {
        ...job,
        correlationId,
      };

      const maybeJobId = jobId?.(payload);
      const typedJobName = jobName as Parameters<Queue<TJobData, unknown, string>['add']>[0];
      const typedPayload = payload as Parameters<Queue<TJobData, unknown, string>['add']>[1];
      await withSpan(
        spanName,
        compactSpanAttributes({
          'aaa.queue.name': queueName,
          ...spanAttributes?.(payload),
        }),
        () =>
          getQueue().add(typedJobName, typedPayload, {
            ...jobOptions,
            ...(maybeJobId ? { jobId: maybeJobId } : {}),
          }),
      );

      if (log) {
        getLogger({
          component,
          correlationId,
          ...log.context?.(payload, correlationId),
        }).info(
          {
            event: log.event,
            outcome: 'accepted',
            ...log.fields?.(payload),
          },
          log.message,
        );
      }
    },
    async close() {
      if (!queue) {
        return;
      }

      await queue.close();
      queue = null;
    },
  };
}
