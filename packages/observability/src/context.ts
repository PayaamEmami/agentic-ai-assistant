import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type Logger } from 'pino';
import type { LogContext, LogStore } from './types.js';

const storage = new AsyncLocalStorage<LogStore>();
let defaultLogger: Logger = pino({ enabled: false });

function compactContext(context: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(context).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    ),
  ) as LogContext;
}

export function setDefaultLogger(logger: Logger): void {
  defaultLogger = logger;
}

export function withLogContext<T>(context: LogContext, fn: () => T): T {
  const parent = storage.getStore();
  const baseLogger = parent?.baseLogger ?? defaultLogger;
  const mergedContext = {
    ...parent?.context,
    ...compactContext(context),
  };
  const logger = baseLogger.child(mergedContext);

  return storage.run(
    {
      context: mergedContext,
      logger,
      baseLogger,
    },
    fn,
  );
}

export function addLogContext(context: LogContext): Logger {
  const store = storage.getStore();
  const nextContext = compactContext(context);

  if (!store) {
    return Object.keys(nextContext).length > 0 ? defaultLogger.child(nextContext) : defaultLogger;
  }

  store.context = {
    ...store.context,
    ...nextContext,
  };
  store.logger = store.baseLogger.child(store.context);
  return store.logger;
}

export function getLogContext(): LogContext {
  return storage.getStore()?.context ?? {};
}

export function getLogger(context?: LogContext): Logger {
  const base = storage.getStore()?.logger ?? defaultLogger;
  const nextContext = context ? compactContext(context) : {};
  return Object.keys(nextContext).length > 0 ? base.child(nextContext) : base;
}
