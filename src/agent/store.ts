/** Persist agent runs / steps and per-site policies (never-act, auto-allow kinds). */
import { openSidekickDB, AGENT_RUNS_STORE, AGENT_STEPS_STORE, SITE_POLICIES_STORE } from "@/src/lib/db";
import type { StepRecord } from "./types";

export interface AgentRunRecord {
  id: string;
  task: string;
  url: string;
  status: "done" | "stopped" | "budget" | "error";
  success?: boolean;
  text?: string;
  error?: string;
  steps: number;
  startedAt: number;
  endedAt: number;
}

export type SitePolicy = {
  site: string; // registrable domain
  neverAct?: boolean;
  /** Kinds the user permanently auto-allows on this site, e.g. "submit:example.com". */
  allowKinds?: string[];
  updatedAt: number;
};

const MAX_RUNS = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export class AgentStore {
  private dbp: ReturnType<typeof openSidekickDB>;
  constructor(dbName?: string) {
    this.dbp = openSidekickDB(dbName);
  }

  async saveRun(run: AgentRunRecord, steps: StepRecord[]) {
    const db = await this.dbp;
    const tx = db.transaction([AGENT_RUNS_STORE, AGENT_STEPS_STORE], "readwrite");
    await tx.objectStore(AGENT_RUNS_STORE).put(run);
    const stepsStore = tx.objectStore(AGENT_STEPS_STORE);
    for (const s of steps) await stepsStore.put({ ...s, runId: run.id });
    await tx.done;
    await this.prune();
  }

  async listRuns(limit = 50): Promise<AgentRunRecord[]> {
    const db = await this.dbp;
    const out: AgentRunRecord[] = [];
    let cur = await db.transaction(AGENT_RUNS_STORE).store.index("startedAt").openCursor(null, "prev");
    while (cur && out.length < limit) {
      out.push(cur.value as AgentRunRecord);
      cur = await cur.continue();
    }
    return out;
  }

  async getSteps(runId: string): Promise<StepRecord[]> {
    const db = await this.dbp;
    return (await db.getAllFromIndex(AGENT_STEPS_STORE, "runId", runId)) as StepRecord[];
  }

  async prune() {
    const db = await this.dbp;
    const cutoff = Date.now() - MAX_AGE_MS;
    const tx = db.transaction([AGENT_RUNS_STORE, AGENT_STEPS_STORE], "readwrite");
    const runs = tx.objectStore(AGENT_RUNS_STORE);
    const steps = tx.objectStore(AGENT_STEPS_STORE);
    const all: AgentRunRecord[] = [];
    let cur = await runs.index("startedAt").openCursor(null, "prev");
    while (cur) {
      all.push(cur.value as AgentRunRecord);
      cur = await cur.continue();
    }
    const drop = new Set<string>();
    all.forEach((r, i) => {
      if (i >= MAX_RUNS || r.startedAt < cutoff) drop.add(r.id);
    });
    for (const id of drop) {
      await runs.delete(id);
      let sc = await steps.index("runId").openCursor(IDBKeyRange.only(id));
      while (sc) {
        await sc.delete();
        sc = await sc.continue();
      }
    }
    await tx.done;
  }

  async getPolicy(site: string): Promise<SitePolicy | undefined> {
    return (await this.dbp).get(SITE_POLICIES_STORE, site);
  }

  async setPolicy(p: SitePolicy) {
    await (await this.dbp).put(SITE_POLICIES_STORE, { ...p, updatedAt: Date.now() });
  }

  async listPolicies(): Promise<SitePolicy[]> {
    return (await (await this.dbp).getAll(SITE_POLICIES_STORE)) as SitePolicy[];
  }

  async deletePolicy(site: string) {
    await (await this.dbp).delete(SITE_POLICIES_STORE, site);
  }
}

export const agentStore = new AgentStore();
