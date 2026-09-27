import { AutomationRunAbandonedError, AutomationRunLog } from '@aaa/db';

/**
 * Records how a scheduled chat turn ended.
 *
 * Tool calls keep the run open; the follow-up turn settles it. A sweeper that
 * already failed the run is ignored so a late model response cannot throw.
 */
export async function noteAutomationTurn(input: {
  runId: string;
  conversationId: string;
  assistantText: string;
  toolNames: string[];
}): Promise<void> {
  const log = new AutomationRunLog(input.runId, input.conversationId);

  try {
    if (input.toolNames.length > 0) {
      await log.enterStage('using_tools');
      await log.progress(`Running ${input.toolNames.join(', ')}`, 'using_tools');
      return;
    }

    const message = input.assistantText.trim() || 'Finished without a reply.';
    await log.finish('completed', { message: 'Prompt finished.', rationale: message });
  } catch (error) {
    if (error instanceof AutomationRunAbandonedError) {
      return;
    }
    throw error;
  }
}
