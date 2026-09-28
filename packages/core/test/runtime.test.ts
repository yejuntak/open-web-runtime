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

test("runtime records bounded screenshot artifacts when the browser supports frames", async () => {
  const provider: BrowserProvider = {
    async createSession() {
      return {
        backend: "fake",
        async observe() { return observation; },
        async execute() {},
        async screenshot() { return { data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" }; },
        async close() {}
      };
    }
  };

  const planner: Planner = {
    async next() { return { type: "complete", result: "done" }; }
  };

  const runtime = new AgentRuntime(provider, planner, undefined, undefined, { maxSteps: 1, captureScreenshots: true });
  const task = runtime.createTask({ goal: "capture" });
  const result = await runtime.run(task.id);
  const artifacts = runtime.artifacts.list(task.id);

  assert.equal(result.status, "completed");
  assert.equal(artifacts.length, 2);
  assert.equal(result.artifactCount, 2);
  assert.equal(result.latestArtifactId, artifacts[1]?.id);
});
