import { openDB, type IDBPDatabase } from "idb";

export interface CacheEntry {
  key: string;
  translation: string;
  createdAt: number;
  lastUsed: number;
}

const DB_NAME = "pagepilot";
const STORE = "translation_cache";

/** IndexedDB translation cache with simple LRU trimming. Lives in the extension origin (service worker). */
export class TranslationCache {
  private dbp: Promise<IDBPDatabase>;
  constructor(private maxEntries = 20000, dbName = DB_NAME) {
    this.dbp = openDB(dbName, 1, {
      upgrade(db) {
        const s = db.createObjectStore(STORE, { keyPath: "key" });
        s.createIndex("lastUsed", "lastUsed");
      },
    });
  }

  async getMany(keys: string[]): Promise<(string | undefined)[]> {
    const db = await this.dbp;
    const tx = db.transaction(STORE, "readwrite");
    const now = Date.now();
    const out = await Promise.all(
      keys.map(async (k) => {
        const e = (await tx.store.get(k)) as CacheEntry | undefined;
        if (e) {
          e.lastUsed = now;
          await tx.store.put(e);
        }
        return e?.translation;
      }),
    );
    await tx.done;
    return out;
  }

  async putMany(entries: { key: string; translation: string }[]): Promise<void> {
    if (!entries.length) return;
    const db = await this.dbp;
    const tx = db.transaction(STORE, "readwrite");
    const now = Date.now();
    await Promise.all(entries.map((e) => tx.store.put({ ...e, createdAt: now, lastUsed: now } satisfies CacheEntry)));
    await tx.done;
    await this.trim();
  }

  async count(): Promise<number> {
    return (await this.dbp).count(STORE);
  }

  async clear(): Promise<void> {
    await (await this.dbp).clear(STORE);
  }

  /** Drop least-recently-used entries beyond maxEntries. */
  async trim(): Promise<number> {
    const db = await this.dbp;
    const n = await db.count(STORE);
    let excess = n - this.maxEntries;
    if (excess <= 0) return 0;
    const removed = excess;
    const tx = db.transaction(STORE, "readwrite");
    let cur = await tx.store.index("lastUsed").openCursor();
    while (cur && excess > 0) {
      await cur.delete();
      excess--;
      cur = await cur.continue();
    }
    await tx.done;
    return removed;
  }
}
