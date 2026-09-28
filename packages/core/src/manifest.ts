import { redactUrlForTrace } from "./trace.js";
import type { ArtifactMetadata, TaskRecord } from "./types.js";

export type RunManifest = {
  schemaVersion: "owr.run.v1";
  exportedAt: string;
  runtime: {
    version: string;
    browserBackend?: string;
    screenshotArtifacts: boolean;
    liveFrames: boolean;
  };
  task: TaskRecord;
  artifacts: ArtifactMetadata[];
};

export function createRunManifest(input: {
  task: TaskRecord;
  artifacts: ArtifactMetadata[];
  runtimeVersion: string;
  screenshotArtifacts: boolean;
  liveFrames: boolean;
}): RunManifest {
  const task = structuredClone(input.task);

  if (task.startUrl) task.startUrl = redactUrlForTrace(task.startUrl);
  if (task.browser) task.browser = { backend: task.browser.backend };

  return {
    schemaVersion: "owr.run.v1",
    exportedAt: new Date().toISOString(),
    runtime: {
      version: input.runtimeVersion,
      ...(task.browser?.backend ? { browserBackend: task.browser.backend } : {}),
      screenshotArtifacts: input.screenshotArtifacts,
      liveFrames: input.liveFrames
    },
    task,
    artifacts: input.artifacts.map(artifact => structuredClone(artifact))
  };
}
