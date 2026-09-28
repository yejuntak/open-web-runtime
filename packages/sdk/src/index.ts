import type { AgentAction, ArtifactMetadata, BrowserActionResult, BrowserSessionMetadata, PageObservation, RunManifest, RuntimeEvent, SearchResult, TaskRecord, WebDocument } from "@owr/core";

export type CreateTaskInput = {
  goal: string;
  startUrl?: string;
  autoRun?: boolean;
};

export type OWRClientOptions = {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
};

export class OWRClient {
  readonly baseUrl: string;
  private token?: string;
  private fetchImpl: typeof fetch;

  constructor(options: OWRClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:8787").replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    return headers;
  }

  private async response(path: string, init?: RequestInit): Promise<Response> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.headers(init?.headers)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OWR HTTP ${response.status}: ${text.slice(0, 1000)}`);
    }
    return response;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    return (await this.response(path, init)).json() as Promise<T>;
  }

  health(): Promise<{ ok: boolean; version: string }> {
    return this.request("/health");
  }

  createBrowserSession(startUrl?: string): Promise<BrowserSessionMetadata> {
    return this.request("/v1/browser/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(startUrl ? { startUrl } : {}) })
    });
  }

  listBrowserSessions(): Promise<BrowserSessionMetadata[]> {
    return this.request("/v1/browser/sessions");
  }

  observeBrowserSession(sessionId: string): Promise<PageObservation> {
    return this.request(`/v1/browser/sessions/${encodeURIComponent(sessionId)}/observe`);
  }

  actBrowserSession(sessionId: string, action: AgentAction, confirmed = false): Promise<BrowserActionResult> {
    return this.request(`/v1/browser/sessions/${encodeURIComponent(sessionId)}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, confirmed })
    });
  }

  async browserScreenshot(sessionId: string): Promise<Blob> {
    return (await this.response(`/v1/browser/sessions/${encodeURIComponent(sessionId)}/screenshot`)).blob();
  }

  closeBrowserSession(sessionId: string): Promise<{ closed: true }> {
    return this.request(`/v1/browser/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  }

  search(input: { query: string; limit?: number }): Promise<{ query: string; provider: string; results: SearchResult[] }> {
    return this.request("/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  }

  fetchPage(input: { url: string; settleMs?: number; maxTextChars?: number }): Promise<WebDocument> {
    return this.request("/v1/fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  }

  createTask(input: CreateTaskInput): Promise<TaskRecord & { inspectorUrl?: string }> {
    return this.request("/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  }

  getTask(taskId: string): Promise<TaskRecord> {
    return this.request(`/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  approve(taskId: string, approved = true): Promise<TaskRecord> {
    return this.request(`/v1/tasks/${encodeURIComponent(taskId)}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved })
    });
  }

  listArtifacts(taskId: string): Promise<ArtifactMetadata[]> {
    return this.request(`/v1/tasks/${encodeURIComponent(taskId)}/artifacts`);
  }

  exportTask(taskId: string): Promise<RunManifest> {
    return this.request(`/v1/tasks/${encodeURIComponent(taskId)}/export`);
  }

  async artifactBlob(artifactId: string): Promise<Blob> {
    return (await this.response(`/v1/artifacts/${encodeURIComponent(artifactId)}`)).blob();
  }

  artifactUrl(artifactId: string): string {
    return `${this.baseUrl}/v1/artifacts/${encodeURIComponent(artifactId)}`;
  }

  inspectorUrl(taskId: string): string {
    return `${this.baseUrl}/inspect/${encodeURIComponent(taskId)}`;
  }

  async *events(taskId: string, signal?: AbortSignal): AsyncGenerator<RuntimeEvent | { type: "task.snapshot"; task: TaskRecord }> {
    const response = await this.response(
      `/v1/tasks/${encodeURIComponent(taskId)}/events`,
      { headers: { accept: "text/event-stream" }, signal }
    );

    if (!response.body) throw new Error("OWR event stream returned no response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split("\n")
            .filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).trimStart())
            .join("\n");
          if (data) yield JSON.parse(data) as RuntimeEvent | { type: "task.snapshot"; task: TaskRecord };
          boundary = buffer.indexOf("\n\n");
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export async function waitForTask(client: OWRClient, taskId: string, options: { intervalMs?: number; signal?: AbortSignal } = {}): Promise<TaskRecord> {
  const intervalMs = options.intervalMs ?? 750;
  while (true) {
    options.signal?.throwIfAborted();
    const task = await client.getTask(taskId);
    if (["completed", "failed", "cancelled", "waiting_for_approval"].includes(task.status)) return task;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs);
      options.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(options.signal?.reason ?? new Error("Aborted"));
      }, { once: true });
    });
  }
}
