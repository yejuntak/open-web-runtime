import test from "node:test";
import assert from "node:assert/strict";
import { createRunManifest, type TaskRecord } from "../src/index.js";

test("run manifest strips URL secrets and browser debug URLs", () => {
  const task: TaskRecord = {
    id: "t1",
    goal: "test",
    startUrl: "https://example.com/path?token=secret#part",
    status: "completed",
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:01.000Z",
    steps: [],
    browser: { backend: "remote-cdp", debugUrl: "https://viewer.example/session?token=secret" },
    result: { ok: true }
  };

  const manifest = createRunManifest({
    task,
    artifacts: [],
    runtimeVersion: "0.1.0",
    screenshotArtifacts: true,
    liveFrames: true
  });

  assert.equal(manifest.schemaVersion, "owr.run.v1");
  assert.equal(manifest.task.startUrl, "https://example.com/path");
  assert.deepEqual(manifest.task.browser, { backend: "remote-cdp" });
  assert.equal(JSON.stringify(manifest).includes("token=secret"), false);
});
