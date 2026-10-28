export interface ActiveChatRun {
  userId: string;
  controller: AbortController;
  conversationId?: string;
}

export class ChatRunRegistry {
  private readonly activeRuns = new Map<string, ActiveChatRun>();

  start(runId: string, userId: string, conversationId?: string): ActiveChatRun {
    if (this.activeRuns.has(runId)) {
      throw new Error(`Chat run already active: ${runId}`);
    }

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

  listForConversation(userId: string, conversationId: string): ActiveChatRun[] {
    const matches: ActiveChatRun[] = [];
    for (const run of this.activeRuns.values()) {
      if (run.userId === userId && run.conversationId === conversationId) {
        matches.push(run);
      }
    }
    return matches;
  }

  abortForConversation(userId: string, conversationId: string): void {
    for (const run of this.listForConversation(userId, conversationId)) {
      if (!run.controller.signal.aborted) {
        run.controller.abort(new Error('Chat run interrupted'));
      }
    }
  }
}
