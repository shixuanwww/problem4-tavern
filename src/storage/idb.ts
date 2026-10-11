import { STORE_NAMES, type StoreName } from '../core/types.ts';

/**
 * IndexedDB 薄封装（手写，不引第三方库 —— 答辩时能讲清每一行）。
 *
 * 两条纪律：
 *  1) 所有【写入】都等事务 oncomplete 之后再返回 —— 否则"刷新后数据丢了"这类问题会以
 *     偶发形式出现，且极难复现。
 *  2) 内存镜像只由调用方（state 层）维护，这里不缓存任何业务数据。
 */

const DB_NAME = 'tavern-lite';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORE_NAMES) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (name === 'messages' || name === 'snapshots') {
          store.createIndex('bySession', 'sessionId', { unique: false });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打开 IndexedDB 失败'));
    request.onblocked = () => reject(new Error('IndexedDB 被其它标签页占用，请关闭其它窗口后重试'));
  });
  return dbPromise;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务被中止'));
  });
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  return wrap<T | undefined>(tx.objectStore(store).get(key));
}

export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  return wrap<T[]>(tx.objectStore(store).getAll());
}

export async function idbGetBySession<T>(store: StoreName, sessionId: string): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  const index = tx.objectStore(store).index('bySession');
  return wrap<T[]>(index.getAll(IDBKeyRange.only(sessionId)));
}

/** 单条写入：等事务完成再返回 */
export async function idbPut<T>(store: StoreName, value: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await txDone(tx);
}

/** 批量写入（同一个事务）：等事务完成再返回 */
export async function idbBulkPut<T>(store: StoreName, values: T[]): Promise<void> {
  if (values.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const objectStore = tx.objectStore(store);
  for (const value of values) objectStore.put(value);
  await txDone(tx);
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await txDone(tx);
}

/** 批量删除（同一个事务）：供"删会话级联删消息 / 快照"用 */
export async function idbDeleteMany(store: StoreName, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const objectStore = tx.objectStore(store);
  for (const key of keys) objectStore.delete(key);
  await txDone(tx);
}
