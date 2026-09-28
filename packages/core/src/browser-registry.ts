import { randomUUID } from "node:crypto";
import { actionPolicy, navigationPolicy } from "./policy.js";
import type { AgentAction, BrowserFrame, BrowserProvider, BrowserSession, PageObservation } from "./types.js";

export type BrowserSessionMetadata = {
  id: string;
  backend: string;
  createdAt: string;
  lastUsedAt: string;
  debugUrl?: string;
};

export type BrowserActionResult =
  | { executed: true; observation: PageObservation }
  | { executed: false; confirmationRequired: string };

export type BrowserSessionRegistryOptions = {
  ttlMs?: number;
  maxSessions?: number;
  allowPrivateNetworks?: boolean;
  requireConfirmationForHighRisk?: boolean;
};

type Entry = {
  session: BrowserSession;
  metadata: BrowserSessionMetadata;
  tail: Promise<void>;
};

export class BrowserSessionRegistry {
  private sessions = new Map<string, Entry>();
  private creating = 0;

  constructor(
    readonly browserProvider: BrowserProvider,
    readonly options: BrowserSessionRegistryOptions = {}
  ) {}

  private maxSessions(): number { return this.options.maxSessions ?? 10; }
  private ttlMs(): number { return this.options.ttlMs ?? 5 * 60_000; }

  async create(startUrl?: string): Promise<BrowserSessionMetadata> {
    if (startUrl) {
      const policy = navigationPolicy(startUrl, this.options.allowPrivateNetworks);
      if (policy.kind === "deny") throw new Error(policy.reason);
    }
    if (this.sessions.size + this.creating >= this.maxSessions()) {
      throw new Error(`Browser session limit (${this.maxSessions()}) reached`);
    }

    this.creating += 1;
    let session: BrowserSession | undefined;
    try {
      session = await this.browserProvider.createSession();
      if (startUrl) await session.execute({ type: "navigate", url: startUrl });
      const now = new Date().toISOString();
      const metadata: BrowserSessionMetadata = {
        id: randomUUID(),
        backend: session.backend,
        createdAt: now,
        lastUsedAt: now,
        ...(session.debugUrl ? { debugUrl: session.debugUrl } : {})
      };
      this.sessions.set(metadata.id, { session, metadata, tail: Promise.resolve() });
      return structuredClone(metadata);
    } catch (error) {
      if (session) await session.close().catch(() => undefined);
      throw error;
    } finally {
      this.creating -= 1;
    }
  }

  list(): BrowserSessionMetadata[] {
    return [...this.sessions.values()].map(entry => structuredClone(entry.metadata));
  }

  getMetadata(id: string): BrowserSessionMetadata | undefined {
    const entry = this.sessions.get(id);
    return entry ? structuredClone(entry.metadata) : undefined;
  }

  private run<T>(id: string, operation: (session: BrowserSession) => Promise<T>): Promise<T> {
    const entry = this.sessions.get(id);
    if (!entry) return Promise.reject(new Error(`Browser session ${id} not found`));

    const result = entry.tail.then(async () => {
      entry.metadata.lastUsedAt = new Date().toISOString();
      return operation(entry.session);
    });
    entry.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  observe(id: string): Promise<PageObservation> {
    return this.run(id, session => session.observe());
  }

  act(id: string, action: AgentAction, confirmed = false): Promise<BrowserActionResult> {
    if (action.type === "complete") return Promise.reject(new Error("complete is not a direct browser action"));

    return this.run(id, async session => {
      if (action.type === "navigate") {
        const policy = navigationPolicy(action.url, this.options.allowPrivateNetworks);
        if (policy.kind === "deny") throw new Error(policy.reason);
      }

      if ("nodeId" in action) {
        const before = await session.observe();
        const decision = actionPolicy(action, before, this.options.requireConfirmationForHighRisk ?? true);
        if (decision.kind === "deny") throw new Error(decision.reason);
        if (decision.kind === "confirm" && !confirmed) {
          return { executed: false, confirmationRequired: decision.reason };
        }
      }

      await session.execute(action);
      return { executed: true, observation: await session.observe() };
    });
  }

  screenshot(id: string): Promise<BrowserFrame> {
    return this.run(id, async session => {
      if (!session.screenshot) throw new Error("Browser provider does not support screenshots");
      return session.screenshot();
    });
  }

  async close(id: string): Promise<boolean> {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    this.sessions.delete(id);
    await entry.tail.catch(() => undefined);
    await entry.session.close().catch(() => undefined);
    return true;
  }

  async sweepExpired(now = Date.now()): Promise<number> {
    const expired = [...this.sessions.values()]
      .filter(entry => now - Date.parse(entry.metadata.lastUsedAt) >= this.ttlMs())
      .map(entry => entry.metadata.id);
    await Promise.all(expired.map(id => this.close(id)));
    return expired.length;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map(id => this.close(id)));
  }
}
