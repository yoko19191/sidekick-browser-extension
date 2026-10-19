import { openDB, type IDBPDatabase } from "idb";
import type { ChatTurn } from "./types";

export const DB_NAME = "sidekick";
export const CACHE_STORE = "translation_cache";
export const CONV_STORE = "conversations";
export const GLOSSARY_STORE = "glossary"; // schema reserved for v2's glossary editor

export function openSidekickDB(name = DB_NAME): Promise<IDBPDatabase> {
  return openDB(name, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) db.createObjectStore(CACHE_STORE, { keyPath: "key" }).createIndex("lastUsed", "lastUsed");
      if (oldVersion < 2) {
        db.createObjectStore(CONV_STORE, { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
        db.createObjectStore(GLOSSARY_STORE, { keyPath: "id", autoIncrement: true }).createIndex("langPair", "langPair");
      }
    },
  });
}

export interface Conversation {
  id: string;
  url: string;
  title: string;
  host: string;
  messages: (ChatTurn & { kind?: string; model?: string })[];
  createdAt: number;
  updatedAt: number;
}

export class ConversationStore {
  private dbp: Promise<IDBPDatabase>;
  constructor(dbName = DB_NAME) {
    this.dbp = openSidekickDB(dbName);
  }
  async put(c: Conversation) {
    await (await this.dbp).put(CONV_STORE, c);
  }
  async get(id: string): Promise<Conversation | undefined> {
    return (await this.dbp).get(CONV_STORE, id);
  }
  async list(limit = 50): Promise<Conversation[]> {
    const db = await this.dbp;
    const out: Conversation[] = [];
    let cur = await db.transaction(CONV_STORE).store.index("updatedAt").openCursor(null, "prev");
    while (cur && out.length < limit) {
      out.push(cur.value as Conversation);
      cur = await cur.continue();
    }
    return out;
  }
  async delete(id: string) {
    await (await this.dbp).delete(CONV_STORE, id);
  }
  async clear() {
    await (await this.dbp).clear(CONV_STORE);
  }
}
