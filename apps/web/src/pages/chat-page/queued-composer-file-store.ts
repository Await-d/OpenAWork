import type { AttachmentItem } from '@openAwork/shared-ui';

const DATABASE_NAME = 'openAwork-chat-queued-files';
const DATABASE_VERSION = 1;
const STORE_NAME = 'queued-files';

interface StoredQueuedComposerFileRecord {
  attachmentId: string;
  blob: Blob;
  id: string;
  lastModified: number;
  name: string;
  queueId: string;
  queueKey: string;
  type: string;
}

function buildQueueKey(scope: string, queueId: string): string {
  return `${scope}:${queueId}`;
}

function buildRecordId(scope: string, queueId: string, attachmentId: string): string {
  return `${scope}:${queueId}:${attachmentId}`;
}

function supportsIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (!supportsIndexedDb()) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error('打开附件恢复数据库失败'));
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? (request.transaction?.objectStore(STORE_NAME) ?? null)
        : database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      if (!store) {
        return;
      }
      if (!store.indexNames.contains('queueKey')) {
        store.createIndex('queueKey', 'queueKey', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  execute: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const database = await openDatabase();
  if (!database) {
    throw new Error('当前环境不支持附件恢复存储');
  }

  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let executeCompleted = false;
    let transactionCompleted = false;
    let settled = false;
    let executeResult: T;

    const closeDatabase = () => {
      database.close();
    };

    const rejectTransaction = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      closeDatabase();
      reject(error instanceof Error ? error : new Error('附件恢复事务失败'));
    };

    const tryResolve = () => {
      if (settled || !executeCompleted || !transactionCompleted) {
        return;
      }
      settled = true;
      closeDatabase();
      resolve(executeResult);
    };

    transaction.onerror = () => {
      rejectTransaction(transaction.error ?? new Error('附件恢复事务失败'));
    };
    transaction.onabort = () => {
      rejectTransaction(transaction.error ?? new Error('附件恢复事务已中止'));
    };
    transaction.oncomplete = () => {
      transactionCompleted = true;
      tryResolve();
    };

    Promise.resolve(execute(store))
      .then((result) => {
        executeResult = result;
        executeCompleted = true;
        tryResolve();
      })
      .catch((error) => {
        rejectTransaction(error);
      });
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('附件恢复请求失败'));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function persistQueuedComposerFiles(args: {
  attachmentItems: AttachmentItem[];
  files: File[];
  queueId: string;
  scope: string;
}): Promise<boolean> {
  const { attachmentItems, files, queueId, scope } = args;
  if (files.length === 0) {
    return true;
  }

  if (!supportsIndexedDb() || attachmentItems.length !== files.length) {
    return false;
  }

  try {
    await runTransaction('readwrite', async (store) => {
      await Promise.all(
        files.map((file, index) => {
          const attachmentItem = attachmentItems[index];
          if (!attachmentItem) {
            throw new Error('附件元数据与文件数量不一致');
          }

          return requestToPromise(
            store.put({
              attachmentId: attachmentItem.id,
              blob: file,
              id: buildRecordId(scope, queueId, attachmentItem.id),
              lastModified: file.lastModified,
              name: file.name,
              queueId,
              queueKey: buildQueueKey(scope, queueId),
              type: file.type,
            } satisfies StoredQueuedComposerFileRecord),
          );
        }),
      );
    });
    return true;
  } catch {
    return false;
  }
}

export async function restoreQueuedComposerFiles(args: {
  attachmentItems: AttachmentItem[];
  queueId: string;
  scope: string;
}): Promise<{ files: File[]; restored: boolean }> {
  const { attachmentItems, queueId, scope } = args;
  if (attachmentItems.length === 0) {
    return { files: [], restored: true };
  }

  if (!supportsIndexedDb()) {
    return { files: [], restored: false };
  }

  try {
    const files = await runTransaction('readonly', async (store) => {
      const restoredRecords = await Promise.all(
        attachmentItems.map(
          (attachmentItem) =>
            requestToPromise(
              store.get(buildRecordId(scope, queueId, attachmentItem.id)),
            ) as Promise<StoredQueuedComposerFileRecord | undefined>,
        ),
      );

      if (restoredRecords.some((item) => !item)) {
        return null;
      }

      return restoredRecords.map((record) => {
        const nextRecord = record as StoredQueuedComposerFileRecord;
        return new File([nextRecord.blob], nextRecord.name, {
          lastModified: nextRecord.lastModified,
          type: nextRecord.type || nextRecord.blob.type || 'application/octet-stream',
        });
      });
    });

    if (!files) {
      return { files: [], restored: false };
    }

    return { files, restored: true };
  } catch {
    return { files: [], restored: false };
  }
}

export async function deleteQueuedComposerFiles(args: {
  queueId: string;
  scope: string;
}): Promise<void> {
  const { queueId, scope } = args;
  if (!supportsIndexedDb()) {
    return;
  }

  try {
    await runTransaction('readwrite', async (store) => {
      const index = store.index('queueKey');
      const range = IDBKeyRange.only(buildQueueKey(scope, queueId));
      const request = index.openCursor(range);
      await new Promise<void>((resolve, reject) => {
        request.onerror = () => reject(request.error ?? new Error('清理附件恢复记录失败'));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          cursor.delete();
          cursor.continue();
        };
      });
    });
  } catch (_error) {
    return;
  }
}
