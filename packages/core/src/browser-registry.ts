import { randomUUID } from "node:crypto";
import { actionPolicy, navigationPolicy } from "./policy.js";
import type { AgentAction, BrowserFrame, BrowserProvider, BrowserSession, PageObservation } from "./types.js";
export type BrowserSessionMetadata = { id: string; backend: string; createdAt: string; lastUsedAt: string; debugUrl?: string };
export type BrowserActionResult = { executed: true; observation: PageObservation } | { executed: false; confirmationRequired: string };
export type BrowserSessionRegistryOptions = { ttlMs?: number; maxSessions?: number; allowPrivateNetworks?: boolean; requireConfirmationForHighRisk?: boolean };
type Entry = { session: BrowserSession; metadata: BrowserSessionMetadata; tail: Promise<void>; pending: number };
export class BrowserSessionRegistry {
  private sessions = new Map<string, Entry>();
  private creating = 0;
  constructor(readonly browserProvider: BrowserProvider, readonly options: BrowserSessionRegistryOptions = {}) {
    for (const [name, value] of Object.entries({ttlMs: options.ttlMs ?? 300000, maxSessions: options.maxSessions ?? 10})) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
    }
  }
  async create(startUrl?: string): Promise<BrowserSessionMetadata> {
    if (startUrl) { const p = navigationPolicy(startUrl, this.options.allowPrivateNetworks); if (p.kind === "deny") throw new Error(p.reason); }
    if (this.sessions.size + this.creating >= (this.options.maxSessions ?? 10)) throw new Error(`Browser session limit (${this.options.maxSessions ?? 10}) reached`);
    this.creating++;
    let session: BrowserSession | undefined;
    try {
      session = await this.browserProvider.createSession();
      if (startUrl) await session.execute({type:"navigate",url:startUrl});
      const now = new Date().toISOString();
      const metadata: BrowserSessionMetadata = {id:randomUUID(),backend:session.backend,createdAt:now,lastUsedAt:now,...(session.debugUrl ? {debugUrl:session.debugUrl} : {})};
      this.sessions.set(metadata.id,{session,metadata,tail:Promise.resolve(),pending:0});
      return structuredClone(metadata);
    } catch (e) { if (session) await session.close().catch(()=>undefined); throw e; }
    finally { this.creating--; }
  }
  list(): BrowserSessionMetadata[] { return [...this.sessions.values()].map(e=>structuredClone(e.metadata)); }
  getMetadata(id: string): BrowserSessionMetadata | undefined { const e=this.sessions.get(id); return e ? structuredClone(e.metadata) : undefined; }
  /** Trusted in-process extension seam; not a remote arbitrary-code endpoint. */
  withSession<T>(id: string, operation: (session: BrowserSession)=>Promise<T>): Promise<T> { return this.run(id,operation); }
  private run<T>(id: string, operation: (session: BrowserSession)=>Promise<T>): Promise<T> {
    const entry=this.sessions.get(id);
    if (!entry) return Promise.reject(new Error(`Browser session ${id} not found`));
    entry.pending++;
    const result=entry.tail.then(async()=>{
      try { entry.metadata.lastUsedAt=new Date().toISOString(); return await operation(entry.session); }
      finally { entry.pending--; entry.metadata.lastUsedAt=new Date().toISOString(); }
    });
    entry.tail=result.then(()=>undefined,()=>undefined);
    return result;
  }
  observe(id: string): Promise<PageObservation> { return this.run(id,s=>s.observe()); }
  act(id: string, action: AgentAction, confirmed=false): Promise<BrowserActionResult> {
    if (action.type === "complete") return Promise.reject(new Error("complete is not a direct browser action"));
    return this.run(id,async session=>{
      if (action.type === "navigate") { const p=navigationPolicy(action.url,this.options.allowPrivateNetworks); if (p.kind === "deny") throw new Error(p.reason); }
      const requireConfirmation=this.options.requireConfirmationForHighRisk ?? true;
      // Enter and implicit form submission must not silently bypass the click gate.
      if (requireConfirmation && !confirmed && ((action.type === "type" && action.submit) || (action.type === "press" && /(^|\+)(Enter|Space|Delete|Backspace)$/i.test(action.key)))) {
        return {executed:false,confirmationRequired:"This keyboard/form action can submit or change external data. Confirm the intended effect first."};
      }
      if ("nodeId" in action) {
        const before=await session.observe();
        const decision=actionPolicy(action,before,requireConfirmation);
        if (decision.kind === "deny") throw new Error(decision.reason);
        if (decision.kind === "confirm" && !confirmed) return {executed:false,confirmationRequired:decision.reason};
      }
      await session.execute(action);
      return {executed:true,observation:await session.observe()};
    });
  }
  screenshot(id: string): Promise<BrowserFrame> { return this.run(id,async s=>{ if (!s.screenshot) throw new Error("Browser provider does not support screenshots"); return s.screenshot(); }); }
  async close(id: string): Promise<boolean> {
    const entry=this.sessions.get(id); if (!entry) return false;
    this.sessions.delete(id); await entry.tail; await entry.session.close().catch(()=>undefined); return true;
  }
  async sweepExpired(now=Date.now()): Promise<number> {
    const ids=[...this.sessions.values()].filter(e=>e.pending === 0 && now-Date.parse(e.metadata.lastUsedAt)>=(this.options.ttlMs??300000)).map(e=>e.metadata.id);
    await Promise.all(ids.map(id=>this.close(id))); return ids.length;
  }
  async closeAll(): Promise<void> { await Promise.all([...this.sessions.keys()].map(id=>this.close(id))); }
}
