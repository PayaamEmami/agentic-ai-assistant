const QUERY_STOPWORDS = new Set([
  'about',
  'does',
  'from',
  'have',
  'info',
  'information',
  'know',
  'like',
  'show',
  'tell',
  'that',
  'them',
  'they',
  'this',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
  'your',
  'you',
  'me',
  'my',
]);

/** Keyword and title wording can add at most this much on top of cosine similarity. */
export const WORKSPACE_TEXT_BOOST_CAP = 0.15;

const CONTENT_KEYWORD_MAX = 0.25;
const TITLE_KEYWORD_MAX = 0.75;
const TITLE_MATCH_MAX = 2.5;
const RAW_BOOST_MAX = CONTENT_KEYWORD_MAX + TITLE_KEYWORD_MAX + TITLE_MATCH_MAX;

function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !QUERY_STOPWORDS.has(token));

  return Array.from(new Set(normalized));
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function keywordBoost(query: string, content: string, maxBoost: number): number {
  const keywords = tokenize(query);
  if (keywords.length === 0) {
    return 0;
  }

  const normalizedContent = content.toLowerCase();
  let matches = 0;
  for (const keyword of keywords) {
    if (normalizedContent.includes(keyword)) {
      matches += 1;
    }
  }

  return (matches / keywords.length) * maxBoost;
}

function titleMatchBoost(query: string, title: string): number {
  const queryTokens = tokenize(query);
  const titleTokens = tokenize(title);
  if (queryTokens.length === 0 || titleTokens.length === 0) {
    return 0;
  }

  const queryTokenSet = new Set(queryTokens);
  const sharedTokens = titleTokens.filter((token) => queryTokenSet.has(token));
  if (sharedTokens.length === 0) {
    return 0;
  }

  const normalizedQuery = normalizeText(query);
  const normalizedTitle = normalizeText(title);
  let boost = 0;

  if (
    normalizedTitle.length > 0 &&
    (normalizedQuery.includes(normalizedTitle) || normalizedTitle.includes(normalizedQuery))
  ) {
    boost += 1.25;
  }

  const titleCoverage = sharedTokens.length / titleTokens.length;
  const queryCoverage = sharedTokens.length / queryTokens.length;
  boost += titleCoverage * 1.25;
  boost += queryCoverage * 0.75;

  const distinctiveSharedTokens = sharedTokens.filter((token) => token.length >= 5);
  if (distinctiveSharedTokens.length >= 2) {
    boost += 0.75;
  } else if (distinctiveSharedTokens.length === 1 && titleCoverage >= 0.5) {
    boost += 0.35;
  }

  return Math.min(boost, TITLE_MATCH_MAX);
}

export function scoreWorkspaceMatch(input: {
  distance: number;
  query: string;
  content: string;
  title: string;
}): number {
  const similarity = Number.isFinite(input.distance) ? 1 - input.distance : 0;
  const raw =
    keywordBoost(input.query, input.content, CONTENT_KEYWORD_MAX) +
    keywordBoost(input.query, input.title, TITLE_KEYWORD_MAX) +
    titleMatchBoost(input.query, input.title);
  const boost = Math.min(
    WORKSPACE_TEXT_BOOST_CAP,
    (raw / RAW_BOOST_MAX) * WORKSPACE_TEXT_BOOST_CAP,
  );
  return similarity + boost;
}
