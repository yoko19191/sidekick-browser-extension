import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { AgentStore } from "../../src/agent/store";
import { DB_NAME } from "../../src/lib/db";

it("saves runs, policies, and prunes old ones", async () => {
  const store = new AgentStore(`${DB_NAME}-agent-${Date.now()}`);
  await store.setPolicy({ site: "evil.com", neverAct: true, updatedAt: Date.now() });
  expect((await store.getPolicy("evil.com"))?.neverAct).toBe(true);
  await store.saveRun(
    { id: "r1", task: "t", url: "https://a.com", status: "done", success: true, text: "ok", steps: 1, startedAt: Date.now(), endedAt: Date.now() },
    [{ n: 1, url: "https://a.com", actions: [{ name: "done", args: {}, ok: true, message: "ok" }] }],
  );
  expect((await store.listRuns())[0].id).toBe("r1");
  expect((await store.getSteps("r1"))).toHaveLength(1);
});
