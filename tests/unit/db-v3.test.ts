import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";
import { openSidekickDB, DB_VERSION } from "../../src/lib/db";

describe("DB v3 upgrade", () => {
  it("upgrades a v2 database without losing conversations", async () => {
    const name = "upgrade-" + Math.random();
    const v2 = await openDB(name, 2, {
      upgrade(db) {
        db.createObjectStore("translation_cache", { keyPath: "key" }).createIndex("lastUsed", "lastUsed");
        db.createObjectStore("conversations", { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
        db.createObjectStore("glossary", { keyPath: "id", autoIncrement: true }).createIndex("langPair", "langPair");
      },
    });
    await v2.put("conversations", { id: "c1", updatedAt: 1 });
    v2.close();
    const db = await openSidekickDB(name);
    expect(db.version).toBe(DB_VERSION);
    for (const s of ["agent_runs", "agent_steps", "site_policies", "scripts", "script_versions", "script_values"])
      expect(db.objectStoreNames.contains(s)).toBe(true);
    expect(await db.get("conversations", "c1")).toMatchObject({ id: "c1" });
    await db.put("agent_steps", { runId: "r1", n: 1 });
    expect(await db.getAllFromIndex("agent_steps", "runId", "r1")).toHaveLength(1);
  });
});
