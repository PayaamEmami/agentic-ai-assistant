export interface CodingTaskCardContent {
  summary?: string;
  error?: string;
  branch?: string;
  pullRequestUrl?: string;
}

function asHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function codingTaskCardContent(output: unknown): CodingTaskCardContent | null {
  if (typeof output !== 'object' || output === null) {
    return null;
  }
  const record = output as Record<string, unknown>;
  const summary = typeof record.summary === 'string' ? record.summary : undefined;
  const error = typeof record.error === 'string' ? record.error : undefined;
  const branch = typeof record.branch === 'string' && record.branch.trim() ? record.branch : undefined;
  const pullRequestUrl = asHttpUrl(record.pullRequestUrl);
  if (!summary && !error && !branch && !pullRequestUrl) {
    return null;
  }
  return {
    ...(summary ? { summary } : {}),
    ...(error ? { error } : {}),
    ...(branch ? { branch } : {}),
    ...(pullRequestUrl ? { pullRequestUrl } : {}),
  };
}
