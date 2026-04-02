export interface NativeToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
}

export const NATIVE_TOOL_DEFINITIONS: NativeToolDefinition[] = [
  {
    name: 'time.now',
    description: 'Get the current server time in ISO-8601 format.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'sum',
    description: 'Calculate the sum of a list of numbers.',
    parameters: {
      type: 'object',
      properties: {
        numbers: {
          type: 'array',
          items: { type: 'number' },
          minItems: 1,
        },
      },
      required: ['numbers'],
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'echo',
    description: 'Echo back the provided text payload.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'external.action',
    description:
      'Execute an external side-effectful action (send, post, modify, delete). Use only when the user asks for an external action.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        payload: { type: 'object' },
      },
      required: ['action'],
      additionalProperties: true,
    },
    requiresApproval: true,
  },
  {
    name: 'github.get_repository',
    description: 'Read metadata for a GitHub repository using the live action connection.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'github.get_file',
    description: 'Read the latest contents of a file from a GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        path: { type: 'string' },
        ref: { type: 'string' },
      },
      required: ['repo', 'path'],
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'github.get_branch',
    description: 'Read metadata for a GitHub branch.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        branch: { type: 'string' },
      },
      required: ['repo', 'branch'],
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'github.get_pull_request',
    description: 'Read metadata for a GitHub pull request.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        pullNumber: { type: 'number' },
      },
      required: ['repo', 'pullNumber'],
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'github.list_pull_request_files',
    description: 'List changed files and patches for a GitHub pull request.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        pullNumber: { type: 'number' },
      },
      required: ['repo', 'pullNumber'],
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'github.create_pull_request',
    description: 'Create a GitHub pull request.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        head: { type: 'string' },
        base: { type: 'string' },
        draft: { type: 'boolean' },
      },
      required: ['repo', 'title', 'head', 'base'],
      additionalProperties: false,
    },
    requiresApproval: true,
  },
  {
    name: 'github.update_pull_request',
    description: 'Update a GitHub pull request title and or body.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        pullNumber: { type: 'number' },
        title: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['repo', 'pullNumber'],
      additionalProperties: false,
    },
    requiresApproval: true,
  },
  {
    name: 'github.add_pull_request_comment',
    description: 'Add a conversation comment to a GitHub pull request.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        pullNumber: { type: 'number' },
        body: { type: 'string' },
      },
      required: ['repo', 'pullNumber', 'body'],
      additionalProperties: false,
    },
    requiresApproval: true,
  },
  {
    name: 'github.reply_to_review_comment',
    description: 'Reply to an existing GitHub pull request review comment thread.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        pullNumber: { type: 'number' },
        commentId: { type: 'number' },
        body: { type: 'string' },
      },
      required: ['repo', 'pullNumber', 'commentId', 'body'],
      additionalProperties: false,
    },
    requiresApproval: true,
  },
  {
    name: 'github.submit_pull_request_review',
    description: 'Submit a GitHub pull request review.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        pullNumber: { type: 'number' },
        event: { type: 'string', enum: ['APPROVE', 'COMMENT', 'REQUEST_CHANGES'] },
        body: { type: 'string' },
      },
      required: ['repo', 'pullNumber', 'event'],
      additionalProperties: false,
    },
    requiresApproval: true,
  },
  {
    name: 'github.coding_task',
    description:
      'Run a long-lived GitHub coding task in a worker sandbox. It can clone a repo, make code changes, validate them, push a branch, and create or update a pull request.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        task: { type: 'string' },
        baseBranch: { type: 'string' },
        targetPullNumber: { type: 'number' },
        validationCommands: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 10,
        },
      },
      required: ['repo', 'task'],
      additionalProperties: false,
    },
    requiresApproval: true,
  },
  {
    name: 'google_drive.search_files',
    description: 'Search Google Drive files using the live action connection.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        pageSize: { type: 'number' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'google_drive.get_file_metadata',
    description: 'Read Google Drive file metadata.',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
      },
      required: ['fileId'],
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'google_drive.read_text_file',
    description: 'Read the latest textual contents of a Google Drive file.',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
      },
      required: ['fileId'],
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'google_drive.create_text_file',
    description: 'Create a text-centric file in Google Drive.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        content: { type: 'string' },
        mimeType: { type: 'string' },
        parentFolderId: { type: 'string' },
      },
      required: ['name', 'content'],
      additionalProperties: false,
    },
    requiresApproval: true,
  },
  {
    name: 'google_drive.update_text_file',
    description: 'Replace the contents of a text-centric Google Drive file.',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        content: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['fileId', 'content'],
      additionalProperties: false,
    },
    requiresApproval: true,
  },
  {
    name: 'google_drive.rename_file',
    description: 'Rename a Google Drive file.',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['fileId', 'name'],
      additionalProperties: false,
    },
    requiresApproval: true,
  },
  {
    name: 'google_drive.move_file',
    description: 'Move a Google Drive file to a different folder.',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        addParentId: { type: 'string' },
        removeParentId: { type: 'string' },
      },
      required: ['fileId', 'addParentId'],
      additionalProperties: false,
    },
    requiresApproval: true,
  },
  {
    name: 'google_drive.trash_file',
    description: 'Move a Google Drive file to trash.',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
      },
      required: ['fileId'],
      additionalProperties: false,
    },
    requiresApproval: true,
  },
  {
    name: 'google_docs.create_document',
    description: 'Create a new Google Docs document.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    requiresApproval: true,
  },
  {
    name: 'google_docs.get_document',
    description: 'Read the structure of a Google Docs document.',
    parameters: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
      },
      required: ['documentId'],
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'google_docs.batch_update_document',
    description: 'Apply structural edits to a Google Docs document using batchUpdate requests.',
    parameters: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        requests: {
          type: 'array',
          items: { type: 'object' },
          minItems: 1,
        },
      },
      required: ['documentId', 'requests'],
      additionalProperties: false,
    },
    requiresApproval: true,
  },
];
