export function isCurrentConversationLoad(input: {
  requestedId: string | undefined;
  currentId: string | undefined;
  loadGeneration: number;
  currentGeneration: number;
}): boolean {
  return input.requestedId === input.currentId && input.loadGeneration === input.currentGeneration;
}
