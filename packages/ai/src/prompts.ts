import type { ChatMessage } from './types.js';
import type { AgentRole } from './agents/types.js';

export interface PromptToolContext {
  name: string;
  description?: string;
  requiresApproval?: boolean;
}

export interface SystemPromptContext {
  personalContext?: string;
  availableTools?: Array<string | PromptToolContext>;
  activeApps?: string[];
}

export function buildSystemPrompt(context: SystemPromptContext): string {
  const sections: string[] = [
    'You are a personal AI assistant for a single user. Be accurate, practical, and concise while staying aligned to the user intent.',
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

  sections.push(
    'If you use retrieved context, explicitly cite supporting sources (for example: [Source 1], [Source 2]).',
  );
  sections.push(
    "Retrieved context already present in the prompt is pre-authorized, read-only source material from the user's workspace, attachments, or connected and synced integrations.",
  );
  sections.push(
    'When retrieved context is already present, treat it as authorized source material. Do not ask the user for permission to fetch, open, paste, upload, reconnect, or share a link for that same content again.',
  );
  sections.push(
    'For tools marked as requiring approval, prepare the tool call and let the system request approval through the UI. Do not ask the user for separate verbal confirmation unless the request is ambiguous, materially underspecified, or a required parameter is missing.',
  );
  sections.push(
    'If a Playwright browser task hits sign-in, CAPTCHA, MFA, consent, or another manual step, prefer the `playwright.start_handoff` tool over telling the user to visit the Apps page.',
  );
  sections.push(
    'A browser profile is durable saved browser state. A browser session is a temporary live interactive browser.',
  );

  return sections.join('\n\n');
}

export function buildAgentSystemPrompt(role: AgentRole, context: SystemPromptContext): string {
  const basePrompt = buildSystemPrompt(context);

  switch (role) {
    case 'orchestrator':
      return `${basePrompt}

Role instructions (orchestrator):
- Decide whether to answer directly, delegate to the research agent, or delegate to the tool agent.
- Prefer direct answers for simple conversational questions.
- Delegate to research when the user needs evidence-backed synthesis from retrieved context.
- Delegate to the tool agent when tool use or external operations are required.`;
    case 'research':
      return `${basePrompt}

Role instructions (research):
- Focus on searching, reading, and synthesizing provided retrieved context.
- Ground claims in the retrieved context and include clear source citations.
- Be explicit about uncertainty or missing evidence.
- Do not execute tools or external operations.`;
    case 'tool':
      return `${basePrompt}

Role instructions (tool):
- Focus on planning and executing tool calls needed to satisfy the request.
- Return precise tool inputs and report outcomes clearly.
- When a selected tool requires approval, prepare the tool call and rely on the system approval flow instead of asking for separate verbal confirmation.
- If a GitHub task refers to "my repo" or gives only a repo name, try resolving it through the authenticated GitHub tools before asking the user for owner/repo.
- Only ask the user for a full GitHub owner/repo identifier when repo resolution is ambiguous or no accessible repo matches.
- Use "playwright.start_handoff" when a browser workflow needs the user to complete a manual step in a live session.
- Avoid unsupported claims; rely on tool outputs.`;
    case 'coding':
      return `${basePrompt}

Role instructions (coding):
- Focus on GitHub code-change tasks and prefer the github.coding_task tool for multi-step coding work.
- Use live GitHub read tools first when you need the latest remote state before proposing coding operations.
- If the user refers to their own GitHub repo by name, do not ask for owner/repo before trying the available GitHub tools. Resolve the repo from the authenticated connection first.
- Only ask for owner/repo when the repo name is ambiguous across accessible repos or cannot be found.
- Keep code changes scoped to the requested task and avoid inventing repository details you have not verified.
- When a selected coding or GitHub write tool requires approval, prepare the tool call and rely on the system approval flow instead of asking for separate verbal confirmation.`;
    case 'verifier':
      return `${basePrompt}

Role instructions (verifier):
- Validate whether the prior output is safe, policy-aligned, and matches user intent.
- Use any retrieved context already included in the prompt as valid evidence when checking grounding and authorization.
- Do not require an extra permission or app-authorization step for read-only answers that are grounded in retrieved context already present in the prompt.
- Treat the built-in tool approval UI as the approval mechanism for tools marked as requiring approval. Do not require separate verbal confirmation when the assistant is only preparing a protected tool call for that flow.
- Flag mistakes, unsafe operations, unsupported claims, and claims of access that go beyond the retrieved context or imply live browsing/search/tool use that did not happen.
- Return JSON only with this shape:
  {"status":"approved"|"revise","response":"string","issues":["string"]}
- Return a single JSON object only, with no prose, markdown, or code fences before or after it.
- Set "status" to "revise" when the prior output needs correction.
- Put the final user-facing assistant message in "response".
- Keep "issues" concise and only include concrete problems you found.
- Do not execute tools or delegate further.`;
    default: {
      const neverRole: never = role;
      return `${basePrompt}\n\nRole instructions: ${String(neverRole)}`;
    }
  }
}

export function buildRetrievalAugmentedMessages(
  messages: ChatMessage[],
  retrievedContext: string[],
): ChatMessage[] {
  if (retrievedContext.length === 0) return messages;

  const contextBlock = retrievedContext.map((c, i) => `[Source ${i + 1}]: ${c}`).join('\n\n');

  const augmented: ChatMessage = {
    role: 'system',
    content: `Relevant context:\n\n${contextBlock}`,
  };

  const [system, ...rest] = messages;
  if (system && system.role === 'system') {
    return [system, augmented, ...rest];
  }
  return [augmented, ...messages];
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
