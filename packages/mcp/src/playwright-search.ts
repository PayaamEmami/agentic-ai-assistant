import type { Locator, Page } from 'playwright';

export type SearchEngine = 'duckduckgo' | 'google' | 'bing';

export interface SearchWebInput {
  query?: unknown;
  searchEngine?: unknown;
  maxResults?: unknown;
}

export interface SearchWebResultItem {
  title: string;
  url: string;
  snippet?: string;
}

export interface SearchWebResult {
  query: string;
  searchEngine: SearchEngine;
  title: string;
  url: string;
  results: SearchWebResultItem[];
  firstResult: SearchWebResultItem | null;
}

const DEFAULT_SEARCH_ENGINE: SearchEngine = 'bing';
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 10;

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseSearchEngine(value: unknown): SearchEngine {
  if (value === 'google' || value === 'bing' || value === 'duckduckgo') {
    return value;
  }

  return DEFAULT_SEARCH_ENGINE;
}

function parseMaxResults(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }

  return Math.max(1, Math.min(Math.trunc(value), MAX_RESULTS_LIMIT));
}

function buildSearchUrl(searchEngine: SearchEngine, query: string): string {
  const encoded = encodeURIComponent(query);
  switch (searchEngine) {
    case 'google':
      return `https://www.google.com/search?q=${encoded}`;
    case 'bing':
      return `https://www.bing.com/search?q=${encoded}`;
    case 'duckduckgo':
      return `https://duckduckgo.com/html/?q=${encoded}`;
  }
}

function decodeBingRedirect(value: string): string | null {
  try {
    const encoded = value.startsWith('a1') ? value.slice(2) : value;
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function unwrapSearchResultUrl(url: string): string {
  try {
    const parsed = new URL(url, 'https://duckduckgo.com');
    const directUrl =
      parsed.searchParams.get('uddg') ??
      parsed.searchParams.get('q') ??
      parsed.searchParams.get('url');
    if (directUrl) {
      return directUrl;
    }

    const bingRedirect = parsed.searchParams.get('u');
    if (bingRedirect && parsed.hostname.includes('bing.com')) {
      return decodeBingRedirect(bingRedirect) ?? parsed.toString();
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

async function textOrUndefined(locator: Locator): Promise<string | undefined> {
  const innerText = await locator.innerText({ timeout: 500 }).catch(() => null);
  const normalizedInnerText = innerText?.replace(/\s+/g, ' ').trim();
  if (normalizedInnerText && normalizedInnerText.length > 0) {
    return normalizedInnerText;
  }

  const textContent = await locator.textContent({ timeout: 500 }).catch(() => null);
  const normalizedTextContent = textContent?.replace(/\s+/g, ' ').trim();
  return normalizedTextContent && normalizedTextContent.length > 0
    ? normalizedTextContent
    : undefined;
}

async function hrefOrUndefined(locator: Locator): Promise<string | undefined> {
  const href = await locator.getAttribute('href', { timeout: 500 }).catch(() => null);
  if (!href) {
    return undefined;
  }

  return unwrapSearchResultUrl(href);
}

async function readDuckDuckGoResults(
  page: Page,
  maxResults: number,
): Promise<SearchWebResultItem[]> {
  await page
    .locator('.result, .web-result')
    .first()
    .waitFor({ state: 'attached', timeout: 5_000 })
    .catch(() => undefined);
  const items = page.locator('.result, .web-result');
  const count = Math.min(await items.count(), maxResults);
  const results: SearchWebResultItem[] = [];

  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const link = item.locator('a.result__a, h2 a, a').first();
    const title = await textOrUndefined(link);
    const url = await hrefOrUndefined(link);
    if (!title || !url) {
      continue;
    }

    const snippet = await textOrUndefined(
      item.locator('.result__snippet, .result__body, .snippet').first(),
    );
    results.push({ title, url, snippet });
  }

  return results;
}

async function readGoogleResults(page: Page, maxResults: number): Promise<SearchWebResultItem[]> {
  await page
    .locator('a:has(h3)')
    .first()
    .waitFor({ state: 'attached', timeout: 5_000 })
    .catch(() => undefined);
  const links = page.locator('a:has(h3)');
  const count = Math.min(await links.count(), maxResults);
  const results: SearchWebResultItem[] = [];

  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index);
    const title = await textOrUndefined(link.locator('h3').first());
    const url = await hrefOrUndefined(link);
    if (title && url) {
      results.push({ title, url });
    }
  }

  return results;
}

async function readBingResults(page: Page, maxResults: number): Promise<SearchWebResultItem[]> {
  await page
    .locator('li.b_algo')
    .first()
    .waitFor({ state: 'attached', timeout: 5_000 })
    .catch(() => undefined);
  const items = page.locator('li.b_algo');
  const count = Math.min(await items.count(), maxResults);
  const results: SearchWebResultItem[] = [];

  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const link = item.locator('h2 a').first();
    const title = await textOrUndefined(link);
    const url = await hrefOrUndefined(link);
    if (!title || !url) {
      continue;
    }

    const snippet = await textOrUndefined(item.locator('.b_caption p, p').first());
    results.push({ title, url, snippet });
  }

  return results;
}

async function readSearchResults(
  page: Page,
  searchEngine: SearchEngine,
  maxResults: number,
): Promise<SearchWebResultItem[]> {
  switch (searchEngine) {
    case 'google':
      return readGoogleResults(page, maxResults);
    case 'bing':
      return readBingResults(page, maxResults);
    case 'duckduckgo':
      return readDuckDuckGoResults(page, maxResults);
  }
}

export async function executeSearchWeb(
  page: Page,
  input: SearchWebInput,
): Promise<
  { success: true; result: SearchWebResult } | { success: false; result: null; error: string }
> {
  const query = asNonEmptyString(input.query);
  if (!query) {
    return {
      success: false,
      result: null,
      error: 'playwright.search_web requires a non-empty query',
    };
  }

  const searchEngine = parseSearchEngine(input.searchEngine);
  const maxResults = parseMaxResults(input.maxResults);
  const searchUrl = buildSearchUrl(searchEngine, query);

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => undefined);

  const results = await readSearchResults(page, searchEngine, maxResults);
  return {
    success: true,
    result: {
      query,
      searchEngine,
      title: await page.title(),
      url: page.url(),
      results,
      firstResult: results[0] ?? null,
    },
  };
}
