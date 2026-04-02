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
  activeConnectors?: string[];
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

  if (context.activeConnectors && context.activeConnectors.length > 0) {
    const connectors = context.activeConnectors.map((connector) => `- ${connector}`).join('\n');
    sections.push(`Active connectors:\n${connectors}`);
  }

  sections.push(
    'If you use retrieved context, explicitly cite supporting sources (for example: [Source 1], [Source 2]).',
  );
  sections.push(
    'Retrieved context already present in the prompt is pre-authorized, read-only source material from the user\'s workspace, attachments, or connected and synced integrations.',
  );
  sections.push(
    'When retrieved context is already present, treat it as authorized source material. Do not ask the user for permission to fetch, open, paste, upload, reconnect, or share a link for that same content again.',
  );
  sections.push(
    'Before taking any external action (sending, posting, modifying, deleting, or executing side-effectful tools), request user approval first.',
  );

  return sections.join('\n\n');
}

export function buildAgentSystemPrompt(role: AgentRole, context: SystemPromptContext): string {
  const basePrompt = buildSystemPrompt(context);

  switch (role) {
    case 'orchestrator':
      return `${basePrompt}

Role instructions (orchestrator):
- Decide whether to answer directly, delegate to the research agent, or delegate to the action agent.
- Prefer direct answers for simple conversational questions.
- Delegate to research when the user needs evidence-backed synthesis from retrieved context.
- Delegate to action when tool use or external operations are required.`;
    case 'research':
      return `${basePrompt}

Role instructions (research):
- Focus on searching, reading, and synthesizing provided retrieved context.
- Ground claims in the retrieved context and include clear source citations.
- Be explicit about uncertainty or missing evidence.
- Do not execute tools or external actions.`;
    case 'action':
      return `${basePrompt}

Role instructions (action):
- Focus on planning and executing tool calls needed to satisfy the request.
- Return precise tool inputs and report outcomes clearly.
- Ask for approval before any external side-effectful operation.
- Avoid unsupported claims; rely on tool outputs.`;
    case 'coding':
      return `${basePrompt}

Role instructions (coding):
- Focus on GitHub code-change tasks and prefer the github.coding_task tool for multi-step coding work.
- Use live GitHub read tools first when you need the latest remote state before proposing coding actions.
- Keep code changes scoped to the requested task and avoid inventing repository details you have not verified.
- Ask for approval before any side-effectful coding task or GitHub write operation.`;
    case 'verifier':
      return `${basePrompt}

Role instructions (verifier):
- Validate whether the prior output is safe, policy-aligned, and matches user intent.
- Use any retrieved context already included in the prompt as valid evidence when checking grounding and authorization.
- Do not require an extra permission or connector-authorization step for read-only answers that are grounded in retrieved context already present in the prompt.
- Flag mistakes, unsafe operations, missing approvals, unsupported claims, and claims of access that go beyond the retrieved context or imply live browsing/search/tool use that did not happen.
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

  const contextBlock = retrievedContext
    .map((c, i) => `[Source ${i + 1}]: ${c}`)
    .join('\n\n');

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
