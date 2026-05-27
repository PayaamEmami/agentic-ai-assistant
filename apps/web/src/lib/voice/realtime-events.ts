export function parseEvent(raw: string): { type?: string; [key: string]: unknown } | null {
  try {
    return JSON.parse(raw) as { type?: string; [key: string]: unknown };
  } catch {
    return null;
  }
}
