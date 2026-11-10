export type ToolExecutionResult =
  | { deferred: true }
  | { success: true; result: unknown }
  | { success: false; result: unknown; error?: string };

export function isDeferredToolResult(
  result: ToolExecutionResult,
): result is { deferred: true } {
  return 'deferred' in result && result.deferred === true;
}

export interface ToolHandlerContext {
  userId: string;
  conversationId: string;
  toolExecutionId: string;
  toolName: string;
  input: Record<string, unknown>;
  assistantMessageId: string | null;
  correlationId: string;
}

export type ToolHandler = (
  context: ToolHandlerContext,
) => Promise<ToolExecutionResult> | ToolExecutionResult;
