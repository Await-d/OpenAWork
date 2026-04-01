// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentItem } from '@openAwork/shared-ui';
import {
  deleteQueuedComposerFiles,
  persistQueuedComposerFiles,
  restoreQueuedComposerFiles,
} from './queued-composer-file-store.js';

type StoredRecord = {
  attachmentId: string;
  blob: Blob;
  id: string;
  lastModified: number;
  name: string;
  queueId: string;
  queueKey: string;
  type: string;
};

class FakeCursor {
  constructor(
    private readonly request: FakeRequest<FakeCursor | null>,
    private readonly entries: Array<[string, StoredRecord]>,
    private index: number,
    private readonly records: Map<string, StoredRecord>,
  ) {}

  delete(): IDBRequest<undefined> {
    const current = this.entries[this.index];
    if (current) {
      this.records.delete(current[0]);
    }
    return createImmediateRequest<undefined>(undefined);
  }

  continue(): void {
    this.index += 1;
    queueMicrotask(() => {
      const nextEntry = this.entries[this.index];
      this.request.result = nextEntry
        ? new FakeCursor(this.request, this.entries, this.index, this.records)
        : null;
      this.request.onsuccess?.(new Event('success'));
    });
  }
}

class FakeIndex {
  constructor(private readonly records: Map<string, StoredRecord>) {}

  openCursor(range: { value: string }): IDBRequest<FakeCursor | null> {
    const entries = Array.from(this.records.entries()).filter(
      ([, value]) => value.queueKey === range.value,
    );
    const firstEntry = entries[0] ?? null;
    return createImmediateRequest<FakeCursor | null>(
      firstEntry
        ? new FakeCursor(createBareRequest<FakeCursor | null>(), entries, 0, this.records)
        : null,
      (request) => {
        request.result = firstEntry ? new FakeCursor(request, entries, 0, this.records) : null;
      },
    );
  }
}

class FakeObjectStore {
  readonly indexNames = {
    contains: (name: string) => this.createdIndexes.has(name),
  };

  private readonly createdIndexes = new Set<string>();

  constructor(private readonly records: Map<string, StoredRecord>) {}

  createIndex(name: string): IDBIndex {
    this.createdIndexes.add(name);
    return {} as IDBIndex;
  }

  put(record: StoredRecord): IDBRequest<string> {
    this.records.set(record.id, record);
    return createImmediateRequest(record.id);
  }

  get(id: string): IDBRequest<StoredRecord | undefined> {
    return createImmediateRequest(this.records.get(id));
  }

  index(_name: string): IDBIndex {
    return new FakeIndex(this.records) as unknown as IDBIndex;
  }
}

class FakeTransaction {
  oncomplete: ((event: Event) => void) | null = null;
  onabort: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  error: DOMException | null = null;

  constructor(
    private readonly store: FakeObjectStore,
    private readonly shouldAbort: boolean,
  ) {
    queueMicrotask(() => {
      if (this.shouldAbort) {
        this.error = new DOMException('transaction aborted', 'AbortError');
        this.onabort?.(new Event('abort'));
        return;
      }
      this.oncomplete?.(new Event('complete'));
    });
  }

  objectStore(): IDBObjectStore {
    return this.store as unknown as IDBObjectStore;
  }
}

class FakeDatabase {
  readonly objectStoreNames = {
    contains: (name: string) => name === 'queued-files',
  };

  private readonly store: FakeObjectStore;

  constructor(
    records: Map<string, StoredRecord>,
    private readonly shouldAbort: () => boolean,
  ) {
    this.store = new FakeObjectStore(records);
  }

  createObjectStore(): IDBObjectStore {
    return this.store as unknown as IDBObjectStore;
  }

  transaction(): IDBTransaction {
    return new FakeTransaction(this.store, this.shouldAbort()) as unknown as IDBTransaction;
  }

  close(): void {}
}

class FakeRequest<T> {
  error: DOMException | null = null;
  onerror: ((event: Event) => void) | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onupgradeneeded: ((event: Event) => void) | null = null;
  result!: T;
  transaction: IDBTransaction | null = null;
}

function createBareRequest<T>(): FakeRequest<T> {
  return new FakeRequest<T>();
}

function createImmediateRequest<T>(
  result: T,
  beforeSuccess?: (request: FakeRequest<T>) => void,
): IDBRequest<T> {
  const request = createBareRequest<T>();
  queueMicrotask(() => {
    request.result = result;
    beforeSuccess?.(request);
    request.onsuccess?.(new Event('success'));
  });
  return request as unknown as IDBRequest<T>;
}

describe('queued composer file store', () => {
  const records = new Map<string, StoredRecord>();
  let initialized = false;
  let abortNextTransaction = false;

  beforeEach(() => {
    records.clear();
    initialized = false;
    abortNextTransaction = false;
    const fakeDatabase = new FakeDatabase(records, () => {
      const next = abortNextTransaction;
      abortNextTransaction = false;
      return next;
    });
    const fakeIndexedDb = {
      open: () => {
        const request = createBareRequest<IDBDatabase>();
        queueMicrotask(() => {
          request.result = fakeDatabase as unknown as IDBDatabase;
          if (!initialized) {
            initialized = true;
            request.onupgradeneeded?.(new Event('upgradeneeded'));
          }
          request.onsuccess?.(new Event('success'));
        });
        return request as unknown as IDBOpenDBRequest;
      },
    };

    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: fakeIndexedDb,
    });
    Object.defineProperty(globalThis, 'IDBKeyRange', {
      configurable: true,
      value: {
        only: (value: string) => ({ value }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists, restores, and deletes queued attachment files by scope and queue id', async () => {
    const attachmentItems: AttachmentItem[] = [
      {
        id: 'attachment-1',
        name: 'notes.txt',
        sizeBytes: 12,
        type: 'file',
      },
    ];
    const files = [new File(['hello world'], 'notes.txt', { type: 'text/plain' })];

    await expect(
      persistQueuedComposerFiles({
        attachmentItems,
        files,
        queueId: 'queue-1',
        scope: 'anonymous:session-1',
      }),
    ).resolves.toBe(true);

    await expect(
      restoreQueuedComposerFiles({
        attachmentItems,
        queueId: 'queue-1',
        scope: 'anonymous:session-1',
      }),
    ).resolves.toMatchObject({
      restored: true,
      files: [expect.objectContaining({ name: 'notes.txt', size: 11, type: 'text/plain' })],
    });

    await deleteQueuedComposerFiles({ queueId: 'queue-1', scope: 'anonymous:session-1' });

    await expect(
      restoreQueuedComposerFiles({
        attachmentItems,
        queueId: 'queue-1',
        scope: 'anonymous:session-1',
      }),
    ).resolves.toEqual({ files: [], restored: false });
  });

  it('returns false when the IndexedDB transaction aborts before commit completes', async () => {
    abortNextTransaction = true;

    await expect(
      persistQueuedComposerFiles({
        attachmentItems: [
          {
            id: 'attachment-abort-1',
            name: 'abort.txt',
            sizeBytes: 5,
            type: 'file',
          },
        ],
        files: [new File(['abort'], 'abort.txt', { type: 'text/plain' })],
        queueId: 'queue-abort',
        scope: 'anonymous:session-abort',
      }),
    ).resolves.toBe(false);
  });
});
