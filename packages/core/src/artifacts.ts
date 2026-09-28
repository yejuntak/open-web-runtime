import { randomUUID } from "node:crypto";
import type { ArtifactMetadata, ArtifactKind } from "./types.js";

type StoredArtifact = {
  metadata: ArtifactMetadata;
  data: Uint8Array;
};

export class InMemoryArtifactStore {
  private artifacts = new Map<string, StoredArtifact>();
  private byTask = new Map<string, string[]>();

  constructor(
    readonly maxArtifactsPerTask = 30,
    readonly maxArtifactBytes = 5 * 1024 * 1024
  ) {}

  put(input: {
    taskId: string;
    kind: ArtifactKind;
    mimeType: string;
    data: Uint8Array;
    step?: number;
    label?: string;
    url?: string;
    title?: string;
  }): ArtifactMetadata {
    if (input.data.byteLength > this.maxArtifactBytes) {
      throw new Error(`Artifact exceeds ${this.maxArtifactBytes} bytes`);
    }

    const metadata: ArtifactMetadata = {
      id: randomUUID(),
      taskId: input.taskId,
      kind: input.kind,
      mimeType: input.mimeType,
      byteLength: input.data.byteLength,
      createdAt: new Date().toISOString(),
      ...(input.step !== undefined ? { step: input.step } : {}),
      ...(input.label ? { label: input.label } : {}),
      ...(input.url ? { url: input.url } : {}),
      ...(input.title ? { title: input.title } : {})
    };

    this.artifacts.set(metadata.id, { metadata, data: new Uint8Array(input.data) });
    const ids = this.byTask.get(input.taskId) ?? [];
    ids.push(metadata.id);
    this.byTask.set(input.taskId, ids);

    while (ids.length > this.maxArtifactsPerTask) {
      const oldest = ids.shift();
      if (oldest) this.artifacts.delete(oldest);
    }

    return structuredClone(metadata);
  }

  list(taskId: string): ArtifactMetadata[] {
    return (this.byTask.get(taskId) ?? [])
      .map(id => this.artifacts.get(id)?.metadata)
      .filter((value): value is ArtifactMetadata => Boolean(value))
      .map(value => structuredClone(value));
  }

  get(id: string): { metadata: ArtifactMetadata; data: Uint8Array } | undefined {
    const value = this.artifacts.get(id);
    return value
      ? { metadata: structuredClone(value.metadata), data: new Uint8Array(value.data) }
      : undefined;
  }
}
