export type ToolExecutionResult = { success: boolean; result: unknown; error?: string };

export interface ToolHandlerContext {
  userId: string;
  conversationId: string;
  toolExecutionId: string;
  toolName: string;
  input: Record<string, unknown>;
  assistantMessageId: string | null;
}

export type ToolHandler = (
  context: ToolHandlerContext,
) => Promise<ToolExecutionResult> | ToolExecutionResult;
