export type BoundingBox = { x: number; y: number; width: number; height: number };

export type NodeAction = "click" | "type" | "select" | "focus";

export type SemanticNode = {
  id: string;
  semanticKey?: string;
  role: string;
  name: string;
  tag: string;
  text: string;
  value?: string;
  href?: string;
  disabled: boolean;
  visible: boolean;
  bbox?: BoundingBox;
  actions: NodeAction[];
};

export type PageObservation = {
  url: string;
  title: string;
  timestamp: string;
  nodes: SemanticNode[];
  textPreview: string;
  accessibilitySummary: Array<{ role: string; name: string; disabled?: boolean }>;
};

export type SemanticNodeSummary = {
  id: string;
  semanticKey: string;
  role: string;
  name: string;
  tag: string;
  text: string;
  value?: string;
  href?: string;
  disabled: boolean;
  visible: boolean;
  actions: NodeAction[];
};

export type SemanticNodeChange = {
  semanticKey: string;
  beforeId: string;
  afterId: string;
  fields: string[];
  after: SemanticNodeSummary;
};

export type ObservationDiff = {
  from: { url: string; title: string };
  to: { url: string; title: string };
  urlChanged: boolean;
  titleChanged: boolean;
  added: SemanticNodeSummary[];
  removed: SemanticNodeSummary[];
  changed: SemanticNodeChange[];
  unchangedCount: number;
};

export type AgentAction =
  | { type: "navigate"; url: string }
  | { type: "click"; nodeId: string }
  | { type: "type"; nodeId: string; text: string; submit: boolean }
  | { type: "select"; nodeId: string; value: string }
  | { type: "press"; key: string }
  | { type: "scroll"; direction: "up" | "down"; amount: number }
  | { type: "wait"; ms: number }
  | { type: "complete"; result: unknown; summary?: string };

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

function nonEmptyString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Expected non-empty string: ${key}`);
  return value;
}

export function parseAgentAction(value: unknown): AgentAction {
  const record = asObject(value);
  const type = nonEmptyString(record, "type");
  switch (type) {
    case "navigate": return { type, url: nonEmptyString(record, "url") };
    case "click": return { type, nodeId: nonEmptyString(record, "nodeId") };
    case "type":
      if (typeof record.text !== "string") throw new Error("Expected string: text");
      return { type, nodeId: nonEmptyString(record, "nodeId"), text: record.text, submit: record.submit === true };
    case "select": return { type, nodeId: nonEmptyString(record, "nodeId"), value: nonEmptyString(record, "value") };
    case "press": return { type, key: nonEmptyString(record, "key") };
    case "scroll": {
      const amount = record.amount === undefined ? 700 : Number(record.amount);
      if ((record.direction !== "up" && record.direction !== "down") || !Number.isInteger(amount) || amount < 100 || amount > 5000) {
        throw new Error("Invalid scroll action");
      }
      return { type, direction: record.direction, amount };
    }
    case "wait": {
      const ms = Number(record.ms);
      if (!Number.isInteger(ms) || ms < 50 || ms > 15000) throw new Error("wait.ms must be 50–15000");
      return { type, ms };
    }
    case "complete":
      return { type, result: record.result, ...(typeof record.summary === "string" ? { summary: record.summary } : {}) };
    default: throw new Error(`Unsupported action type: ${type}`);
  }
}

export type RecordedAgentAction =
  | { type: "navigate"; url: string }
  | { type: "click"; nodeId: string }
  | { type: "type"; nodeId: string; textLength: number; submit: boolean }
  | { type: "select"; nodeId: string; valueLength: number }
  | { type: "press"; key: string }
  | { type: "scroll"; direction: "up" | "down"; amount: number }
  | { type: "wait"; ms: number }
  | { type: "complete"; summary?: string };

export type StepRecord = {
  step: number;
  action: RecordedAgentAction;
  before: Pick<PageObservation, "url" | "title">;
  after?: Pick<PageObservation, "url" | "title">;
  ok: boolean;
  error?: string;
  durationMs: number;
};

export type ArtifactKind = "screenshot";

export type ArtifactMetadata = {
  id: string;
  taskId: string;
  kind: ArtifactKind;
  mimeType: string;
  byteLength: number;
  sha256: string;
  createdAt: string;
  step?: number;
  label?: string;
  url?: string;
  title?: string;
};

export type BrowserFrame = {
  data: Uint8Array;
  mimeType: string;
  capturedAt?: string;
  url?: string;
};

export type LiveFrameMetadata = {
  taskId: string;
  sequence: number;
  mimeType: string;
  byteLength: number;
  capturedAt: string;
  url?: string;
};

export type TaskStatus = "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";

export type TaskRecord = {
  id: string;
  goal: string;
  startUrl?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  result?: unknown;
  error?: string;
  steps: StepRecord[];
  browser?: { backend: string; debugUrl?: string };
  approval?: { reason: string; action: RecordedAgentAction };
  latestArtifactId?: string;
  artifactCount?: number;
};

export type RuntimeEvent =
  | { type: "task.created"; taskId: string; at: string }
  | { type: "browser.ready"; taskId: string; at: string; backend: string; debugUrl?: string }
  | { type: "artifact.created"; taskId: string; at: string; artifact: ArtifactMetadata }
  | { type: "step.started"; taskId: string; at: string; step: number; action: RecordedAgentAction }
  | { type: "step.completed"; taskId: string; at: string; step: number; url: string; title: string; durationMs: number }
  | { type: "step.failed"; taskId: string; at: string; step: number; error: string; durationMs: number }
  | { type: "task.waiting_for_approval"; taskId: string; at: string; reason: string; action: RecordedAgentAction }
  | { type: "task.completed"; taskId: string; at: string; result: unknown }
  | { type: "task.cancelled"; taskId: string; at: string; reason: string }
  | { type: "task.failed"; taskId: string; at: string; error: string };

export interface BrowserSession {
  backend: string;
  debugUrl?: string;
  observe(): Promise<PageObservation>;
  execute(action: AgentAction): Promise<void>;
  screenshot?(): Promise<BrowserFrame>;
  subscribeFrames?(listener: (frame: BrowserFrame) => void): Promise<() => void | Promise<void>>;
  close(): Promise<void>;
}

export interface BrowserProvider { createSession(): Promise<BrowserSession> }

export type PlannerContext = {
  goal: string;
  step: number;
  observation: PageObservation;
  diff?: ObservationDiff;
  history: StepRecord[];
};

export interface Planner { next(context: PlannerContext): Promise<AgentAction> }
