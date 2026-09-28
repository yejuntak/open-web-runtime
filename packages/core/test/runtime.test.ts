import test from "node:test";
import assert from "node:assert/strict";
import { AgentRuntime, type AgentAction, type BrowserProvider, type PageObservation, type Planner } from "../src/index.js";

const observation: PageObservation = {
  url: "https://example.com",
  title: "Example",
  timestamp: new Date().toISOString(),
  textPreview: "Example",
  accessibilitySummary: [],
  nodes: []
};

test("runtime executes a typed action and completes", async () => {
  const executed: AgentAction[] = [];
  const provider: BrowserProvider = {
    async createSession() {
      return {
        backend: "fake",
        async observe() { return observation; },
        async execute(action) { executed.push(action); },
        async close() {}
      };
    }
  };

  let turn = 0;
  const planner: Planner = {
    async next() {
      turn += 1;
      return turn === 1
        ? { type: "wait", ms: 50 }
        : { type: "complete", result: { ok: true } };
    }
  };

  const runtime = new AgentRuntime(provider, planner, undefined, undefined, { maxSteps: 3 });
  const task = runtime.createTask({ goal: "finish" });
  const result = await runtime.run(task.id);

  assert.equal(result.status, "completed");
  assert.deepEqual(result.result, { ok: true });
  assert.equal(executed[0]?.type, "wait");
});
