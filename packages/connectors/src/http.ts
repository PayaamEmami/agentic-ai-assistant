export async function requestJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export async function requestText(
  input: string,
  init?: RequestInit,
): Promise<string> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body || response.statusText}`);
  }

  return response.text();
}
