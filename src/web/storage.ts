/**
 * 本地存档：把完整牌局、结算帧、待选项、随机状态与版本写入 IndexedDB。
 * 浏览器刷新后可以继续上一局。
 */

const DB_NAME = 'banan-sha';
const DB_VERSION = 1;
const STORE = 'saves';
const LS_PREFIX = 'banan-sha-save:';

export interface SaveMeta {
  slot: string;
  savedAt: string;
  selfSeat: number;
  characterName: string;
  playerCount: number;
  round: number;
  turnSerial: number;
  engineVersion: string;
  rulesVersion: string;
  contentVersion: string;
}

export interface SaveRecord {
  meta: SaveMeta;
  stateJson: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'meta.slot' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('无法打开本地数据库'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('本地数据库操作失败'));
    tx.oncomplete = () => db.close();
  });
}

export async function saveGame(record: SaveRecord): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(record));
  } catch {
    // 兜底：IndexedDB 不可用时退化为 localStorage。
    try {
      localStorage.setItem(LS_PREFIX + record.meta.slot, JSON.stringify(record));
    } catch {
      /* 忽略：本地存储被禁用时不影响当前对局 */
    }
  }
}

export async function loadGame(slot = 'auto'): Promise<SaveRecord | null> {
  try {
    const r = await withStore<SaveRecord | undefined>('readonly', (s) => s.get(slot));
    if (r) return r;
  } catch {
    /* 走兜底 */
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + slot);
    return raw ? (JSON.parse(raw) as SaveRecord) : null;
  } catch {
    return null;
  }
}

export async function clearGame(slot = 'auto'): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(slot));
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(LS_PREFIX + slot);
  } catch {
    /* ignore */
  }
}

/** 触发一次文件下载（开发用的复现文件导出）。 */
export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
