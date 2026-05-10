export function formatTimestamp(value: string | null): string {
  if (!value) {
    return 'Never';
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? 'Unknown time' : timestamp.toLocaleString().replace(',', '');
}

export function selectedRepositoryLabel(count: number): string {
  if (count === 0) {
    return '0 repositories selected for indexing';
  }

  if (count === 1) {
    return '1 repository selected for indexing';
  }

  return `${count} repositories selected for indexing`;
}

export function indexedSourcesLabel(count: number): string {
  if (count === 1) {
    return '1 source indexed';
  }

  return `${count} sources indexed`;
}
