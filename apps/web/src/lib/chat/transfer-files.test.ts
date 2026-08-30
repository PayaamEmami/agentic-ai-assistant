import { describe, expect, it } from 'vitest';
import { extractTransferFiles, transferContainsFiles } from './transfer-files';

function createFile(name: string, contents = 'hello', type = 'text/plain'): File {
  return new File([contents], name, { type });
}

function createDataTransfer(options: {
  types?: string[];
  items?: Array<Partial<DataTransferItem> & { kind: string }>;
  files?: File[];
}): DataTransfer {
  return {
    types: options.types ?? [],
    items: options.items ?? [],
    files: options.files ?? [],
  } as unknown as DataTransfer;
}

describe('transferContainsFiles', () => {
  it('detects a Files drag type', () => {
    expect(transferContainsFiles(createDataTransfer({ types: ['Files'] }))).toBe(true);
    expect(transferContainsFiles(createDataTransfer({ types: ['text/plain'] }))).toBe(false);
    expect(transferContainsFiles(null)).toBe(false);
  });
});

describe('extractTransferFiles', () => {
  it('reads file items and ignores string items', () => {
    const note = createFile('note.txt');
    const files = extractTransferFiles(
      createDataTransfer({
        items: [
          { kind: 'string', getAsFile: () => null },
          { kind: 'file', getAsFile: () => note },
        ],
      }),
    );

    expect(files).toEqual([note]);
  });

  it('skips dropped directories', () => {
    const note = createFile('note.txt');
    const files = extractTransferFiles(
      createDataTransfer({
        items: [
          {
            kind: 'file',
            getAsFile: () => createFile('docs'),
            webkitGetAsEntry: () => ({ isDirectory: true }) as FileSystemEntry,
          },
          {
            kind: 'file',
            getAsFile: () => note,
            webkitGetAsEntry: () => ({ isDirectory: false }) as FileSystemEntry,
          },
        ],
      }),
    );

    expect(files).toEqual([note]);
  });

  it('falls back to the files list when items are empty', () => {
    const image = createFile('shot.png', 'img', 'image/png');
    const files = extractTransferFiles(
      createDataTransfer({
        files: [image],
      }),
    );

    expect(files).toEqual([image]);
  });

  it('names unnamed files with the given prefix', () => {
    const unnamed = new File(['png'], '', { type: 'image/png' });
    const [named] = extractTransferFiles(
      createDataTransfer({
        items: [{ kind: 'file', getAsFile: () => unnamed }],
      }),
      'pasted',
    );

    expect(named).toBeDefined();
    expect(named?.name).toMatch(/^pasted-\d+\.png$/);
    expect(named?.type).toBe('image/png');
  });

  it('returns an empty list for a missing transfer', () => {
    expect(extractTransferFiles(null)).toEqual([]);
  });
});
