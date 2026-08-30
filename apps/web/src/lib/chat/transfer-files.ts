export function transferContainsFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) {
    return false;
  }

  return Array.from(dataTransfer.types ?? []).includes('Files');
}

export function extractTransferFiles(
  dataTransfer: DataTransfer | null | undefined,
  unnamedPrefix = 'attachment',
): File[] {
  if (!dataTransfer) {
    return [];
  }

  const items = Array.from(dataTransfer.items ?? []);
  if (items.length > 0) {
    return nameFiles(filesFromItems(items), unnamedPrefix);
  }

  return nameFiles(Array.from(dataTransfer.files ?? []), unnamedPrefix);
}

function filesFromItems(items: DataTransferItem[]): File[] {
  const files: File[] = [];

  for (const item of items) {
    if (item.kind !== 'file' || isDirectoryItem(item)) {
      continue;
    }

    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }

  return files;
}

function isDirectoryItem(item: DataTransferItem): boolean {
  const entry = item.webkitGetAsEntry?.() ?? null;
  return Boolean(entry?.isDirectory);
}

function nameFiles(files: File[], unnamedPrefix: string): File[] {
  return files.map((file) =>
    file.name
      ? file
      : new File([file], inferUnnamedFileName(file, unnamedPrefix), { type: file.type }),
  );
}

function inferUnnamedFileName(file: File, prefix: string): string {
  const subtype = file.type.split('/')[1]?.split(';')[0] || 'bin';
  return `${prefix}-${Date.now()}.${subtype}`;
}
