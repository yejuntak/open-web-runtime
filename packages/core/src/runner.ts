import { randomUUID } from "node:crypto";
import { InMemoryArtifactStore } from "./artifacts.js";
import { diffObservations } from "./diff.js";
import { RuntimeEventBus } from "./events.js";
import { actionPolicy, navigationPolicy } from "./policy.js";
import { InMemoryTaskStore } from "./store.js";
import type { BrowserProvider, BrowserSession, PageObservation, Planner, StepRecord, TaskRecord } from "./types.js";

export type AgentRuntimeOptions = {
  maxSteps?: number;
  allowPrivateNetworks?: boolean;
  requireConfirmationForHighRisk?: boolean;
  captureScreenshots?: boolean;
};

export class AgentRuntime {
  constructor(
    readonly browserProvider: BrowserProvider,
    readonly planner: Planner,
    readonly store = new InMemoryTaskStore(),
    readonly events = new RuntimeEventBus(),
    readonly options: AgentRuntimeOptions = {},
    readonly artifacts = new InMemoryArtifactStore()
  ) {}

  createTask(input: { goal: string; startUrl?: string }): TaskRecord {
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: randomUUID(), goal: input.goal, startUrl: input.startUrl,
      status: "queued", createdAt: now, updatedAt: now, steps: [], artifactCount: 0
    };
    this.store.create(task);
    this.events.emit({ type: "task.created", taskId: task.id, at: now });
    return task;
  }

  private async capture(
    taskId: string,
    browser: BrowserSession,
    label: string,
    observation?: PageObservation,
    step?: number
  ): Promise<void> {
    if (this.options.captureScreenshots === false || !browser.screenshot) return;
    try {
      const frame = await browser.screenshot();
      const artifact = this.artifacts.put({
        taskId,
        kind: "screenshot",
        mimeType: frame.mimeType,
        data: frame.data,
        label,
        ...(step !== undefined ? { step } : {}),
        ...(observation?.url ? { url: observation.url } : {}),
        ...(observation?.title ? { title: observation.title } : {})
      });
      const count = this.artifacts.list(taskId).length;
      this.store.update(taskId, record => {
        record.latestArtifactId = artifact.id;
        record.artifactCount = count;
      });
      this.events.emit({ type: "artifact.created", taskId, at: artifact.createdAt, artifact });
    } catch {
      // Artifacts are observability aids and must never fail task execution.
    }
  }

  async run(taskId: string): Promise<TaskRecord> {
    const task = this.store.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    this.store.update(taskId, record => { record.status = "running"; });

    const browser = await this.browserProvider.createSession();
    this.store.update(taskId, record => { record.browser = { backend: browser.backend, debugUrl: browser.debugUrl }; });
    this.events.emit({ type: "browser.ready", taskId, at: new Date().toISOString(), backend: browser.backend, debugUrl: browser.debugUrl });

    try {
      if (task.startUrl) {
        const policy = navigationPolicy(task.startUrl, this.options.allowPrivateNetworks);
        if (policy.kind === "deny") throw new Error(policy.reason);
        await browser.execute({ type: "navigate", url: task.startUrl });
      }

      const maxSteps = this.options.maxSteps ?? 20;
      for (let step = 1; step <= maxSteps; step += 1) {
        const observation = await browser.observe();
        await this.capture(taskId, browser, step === 1 ? "initial" : "observe", observation, step);

        const current = this.store.get(taskId)!;
        const action = await this.planner.next({ goal: current.goal, step, observation, history: current.steps });

        if (action.type === "complete") {
          await this.capture(taskId, browser, "complete", observation, step);
          this.store.update(taskId, record => { record.status = "completed"; record.result = action.result; });
          this.events.emit({ type: "task.completed", taskId, at: new Date().toISOString(), result: action.result });
          return this.store.get(taskId)!;
        }

        if (action.type === "navigate") {
          const policy = navigationPolicy(action.url, this.options.allowPrivateNetworks);
          if (policy.kind === "deny") throw new Error(policy.reason);
        }

        const policy = actionPolicy(action, observation, this.options.requireConfirmationForHighRisk ?? true);
        if (policy.kind === "deny") throw new Error(policy.reason);
        if (policy.kind === "confirm") {
          await this.capture(taskId, browser, "approval", observation, step);
          this.events.emit({ type: "task.waiting_for_approval", taskId, at: new Date().toISOString(), reason: policy.reason, action });
          const approved = await this.store.waitForApproval(taskId, action, policy.reason);
          if (!approved) {
            const reason = "Action was not approved.";
            this.events.emit({ type: "task.cancelled", taskId, at: new Date().toISOString(), reason });
            return this.store.get(taskId)!;
          }
        }

        this.events.emit({ type: "step.started", taskId, at: new Date().toISOString(), step, action });
        const started = performance.now();
        let record: StepRecord;
        try {
          await browser.execute(action);
          const after = await browser.observe();
          await this.capture(taskId, browser, `after:${action.type}`, after, step);
          const durationMs = Math.round(performance.now() - started);
          record = { step, action, before: { url: observation.url, title: observation.title }, after: { url: after.url, title: after.title }, ok: true, durationMs };
          this.events.emit({ type: "step.completed", taskId, at: new Date().toISOString(), step, url: after.url, title: after.title, durationMs });
        } catch (error) {
          const durationMs = Math.round(performance.now() - started);
          const message = error instanceof Error ? error.message : String(error);
          record = { step, action, before: { url: observation.url, title: observation.title }, ok: false, error: message, durationMs };
          this.events.emit({ type: "step.failed", taskId, at: new Date().toISOString(), step, error: message, durationMs });
        }
        this.store.update(taskId, recordTask => { recordTask.steps.push(record); });
      }
      throw new Error(`Maximum step count (${maxSteps}) reached without completion.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.update(taskId, record => { record.status = record.status === "cancelled" ? "cancelled" : "failed"; record.error = message; });
      this.events.emit({ type: "task.failed", taskId, at: new Date().toISOString(), error: message });
      return this.store.get(taskId)!;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
}
