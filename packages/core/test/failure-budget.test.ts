import test from "node:test";
import assert from "node:assert/strict";
import { AgentRuntime, type BrowserProvider, type PageObservation, type Planner } from "../src/index.js";

const page: PageObservation = {
  url: "https://example.com",
  title: "Example",
  timestamp: "2026-09-28T00:00:00.000Z",
  textPreview: "",
  accessibilitySummary: [],
  nodes: []
};

test("runtime stops after the configured consecutive action failure budget", async () => {
  const provider: BrowserProvider = {
    async createSession() {
      return {
        backend: "fake",
        async observe() { return page; },
        async execute() { throw new Error("network ECONNRESET"); },
        async close() {}
      };
    }
  };
  const planner: Planner = { async next() { return { type: "wait", ms: 50 }; } };
  const runtime = new AgentRuntime(provider, planner, undefined, undefined, {
    maxSteps: 10,
    maxConsecutiveActionFailures: 2,
    captureScreenshots: false
  });
  const task = runtime.createTask({ goal: "recover" });
  const result = await runtime.run(task.id);

  assert.equal(result.status, "failed");
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0]?.failure?.code, "network");
  assert.equal(result.failure?.code, "action_failure_budget_exhausted");
});
