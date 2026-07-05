export interface ActiveChatRun {
  userId: string;
  controller: AbortController;
  conversationId?: string;
}

export class ChatRunRegistry {
  private readonly activeRuns = new Map<string, ActiveChatRun>();

  start(runId: string, userId: string, conversationId?: string): ActiveChatRun {
    const run: ActiveChatRun = {
      userId,
      controller: new AbortController(),
      conversationId,
    };
    this.activeRuns.set(runId, run);
    return run;
  }

  get(runId: string): ActiveChatRun | undefined {
    return this.activeRuns.get(runId);
  }

  setConversation(runId: string, conversationId: string): void {
    const run = this.activeRuns.get(runId);
    if (run) {
      run.conversationId = conversationId;
    }
  }

  finish(runId: string): void {
    this.activeRuns.delete(runId);
  }
}
