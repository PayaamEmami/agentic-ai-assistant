export interface PromptToolContext {
  name: string;
  description?: string;
  requiresApproval?: boolean;
}

export interface SystemPromptContext {
  personalContext?: string;
  availableTools?: Array<string | PromptToolContext>;
  activeApps?: string[];
  /**
   * When false, the base prompt omits the retrieval and tool-approval guidance
   * blocks. Callers that run without retrieval or tools (such as a strictly
   * conversational voice session) set this to false to avoid sending
   * contradictory instructions to the model.
   */
  includeToolGuidance?: boolean;
  /**
   * When false, the retrieval guidance block is omitted. That block describes
   * excerpts already pasted into the prompt. Chat and voice leave it off and
   * load notes through search_workspace instead. Defaults to `includeToolGuidance`.
   */
  includeRetrievalGuidance?: boolean;
}

export function buildSystemPrompt(context: SystemPromptContext): string {
  const sections: string[] = [
    'You are an AI assistant for a single user. Be accurate, practical, and concise while staying aligned to the user intent.',
  ];

  if (context.personalContext) {
    sections.push(`User profile context:\n${context.personalContext}`);
  }

  if (context.availableTools && context.availableTools.length > 0) {
    const tools = context.availableTools.map(formatToolEntry).join('\n');
    sections.push(`Available tools:\n${tools}`);
  }

  if (context.activeApps && context.activeApps.length > 0) {
    const apps = context.activeApps.map((app) => `- ${app}`).join('\n');
    sections.push(`Connected apps:\n${apps}`);
  }

  const includeToolGuidance = context.includeToolGuidance ?? true;
  const includeRetrievalGuidance = context.includeRetrievalGuidance ?? includeToolGuidance;

  if (includeRetrievalGuidance) {
    sections.push(
      'If you use retrieved context, explicitly cite supporting sources (for example: [Source 1], [Source 2]).',
    );
    sections.push(
      "Retrieved context already present in the prompt is pre-authorized, read-only source material from the user's workspace, attachments, or connected and synced integrations.",
    );
    sections.push(
      'When retrieved context is already present, treat it as authorized source material. Do not ask the user for permission to fetch, open, paste, upload, reconnect, or share a link for that same content again.',
    );
  }

  if (includeToolGuidance) {
    sections.push(
      'For tools marked as requiring approval, prepare the tool call and let the system request approval through the UI. Do not ask the user for separate verbal confirmation unless the request is ambiguous, materially underspecified, or a required parameter is missing.',
    );
    sections.push(
      'When the user explicitly asks you to use an available tool by name or capability, use that tool unless the request is unsafe or a required input is missing. Do not answer from memory while implying that tool or live access happened.',
    );
  }

  return sections.join('\n\n');
}

export function buildChatTurnPrompt(context: SystemPromptContext): string {
  return `${buildSystemPrompt({ ...context, includeRetrievalGuidance: false })}

Turn instructions:
- Hosted web search is available. Use it for a current public fact. Skip it for the user's own files, casual chat, and live tool work. Do not claim a web search happened unless that tool ran.
- Call search_workspace for the user's indexed notes, attachments, and synced knowledge. Cite those excerpts as [Source N]. Do not use it for current public facts or for live GitHub, Google, or MCP operations.
- When indexed sources and another tool are both needed, call search_workspace on its own first, then call the other tool after you have the excerpts.
- Use github.coding_task for a multi-step GitHub code change. Use live GitHub read tools when you need the latest remote state first.
- If a GitHub task refers to "my repo" or gives only a repo name, resolve it through the authenticated GitHub tools before asking for owner/repo. Only ask for a full owner/repo when resolution is ambiguous or no accessible repo matches.
- Keep code changes scoped to the requested task and avoid inventing repository details you have not verified.`;
}

function formatToolEntry(tool: string | PromptToolContext): string {
  if (typeof tool === 'string') {
    return `- ${tool}`;
  }

  const details: string[] = [];
  if (tool.description) {
    details.push(tool.description);
  }
  if (tool.requiresApproval !== undefined) {
    details.push(tool.requiresApproval ? 'requires approval' : 'no approval required');
  }

  return details.length > 0 ? `- ${tool.name}: ${details.join('; ')}` : `- ${tool.name}`;
}
