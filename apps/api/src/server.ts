import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { browserProviderFromEnv } from "@owr/browser";
import { AgentRuntime, createRunManifest, OpenAICompatiblePlanner } from "@owr/core";
import { inspectorHtml } from "./inspector.js";

const planner = new OpenAICompatiblePlanner({
  baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
  apiKey: process.env.LLM_API_KEY ?? "",
  model: process.env.LLM_MODEL ?? "gpt-5.6"
});

const runtime = new AgentRuntime(
  browserProviderFromEnv(),
  planner,
  undefined,
  undefined,
  {
    maxSteps: Number(process.env.MAX_AGENT_STEPS ?? 20),
    allowPrivateNetworks: process.env.ALLOW_PRIVATE_NETWORKS === "true",
    requireConfirmationForHighRisk: process.env.REQUIRE_CONFIRMATION_FOR_HIGH_RISK !== "false",
    captureScreenshots: process.env.CAPTURE_SCREENSHOTS !== "false",
    liveFrames: process.env.LIVE_FRAMES !== "false"
  }
);

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(body);
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; img-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer"
  });
  res.end(body);
}

function unauthorized(res: ServerResponse): void {
  json(res, 401, { error: "Unauthorized" });
}

function authorized(req: IncomingMessage): boolean {
  const token = process.env.OWR_API_TOKEN;
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Request body exceeds 1 MB");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON body must be an object");
  return value as Record<string, unknown>;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, version: "0.1.0" });
    }

    const inspectorMatch = /^\/inspect\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && inspectorMatch) {
      return html(res, inspectorHtml(decodeURIComponent(inspectorMatch[1]!)));
    }

    if (!authorized(req)) return unauthorized(res);

    if (req.method === "GET" && url.pathname === "/") {
      return json(res, 200, {
        name: "Open Web Runtime",
        version: "0.1.0",
        endpoints: [
          "POST /v1/tasks",
          "GET /v1/tasks/:id",
          "GET /v1/tasks/:id/events",
          "GET /v1/tasks/:id/artifacts",
          "GET /v1/tasks/:id/export",
          "GET /v1/tasks/:id/frame",
          "GET /v1/artifacts/:id",
          "POST /v1/tasks/:id/approval",
          "GET /inspect/:id"
        ]
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/tasks") {
      const body = await readJson(req);
      if (typeof body.goal !== "string" || !body.goal.trim() || body.goal.length > 20_000) {
        return json(res, 400, { error: "goal must be a non-empty string up to 20,000 characters" });
      }
      const startUrl = body.startUrl === undefined ? undefined : String(body.startUrl);
      if (startUrl) {
        try { new URL(startUrl); } catch { return json(res, 400, { error: "startUrl must be an absolute URL" }); }
      }
      const task = runtime.createTask({ goal: body.goal, startUrl });
      if (body.autoRun !== false) queueMicrotask(() => { void runtime.run(task.id); });
      return json(res, 201, {
        ...task,
        inspectorUrl: `/inspect/${encodeURIComponent(task.id)}`
      });
    }

    const exportMatch = /^\/v1\/tasks\/([^/]+)\/export$/.exec(url.pathname);
    if (req.method === "GET" && exportMatch) {
      const taskId = exportMatch[1]!;
      const task = runtime.store.get(taskId);
      if (!task) return json(res, 404, { error: "Task not found" });
      return json(res, 200, createRunManifest({
        task,
        artifacts: runtime.artifacts.list(taskId),
        runtimeVersion: "0.1.0",
        screenshotArtifacts: process.env.CAPTURE_SCREENSHOTS !== "false",
        liveFrames: process.env.LIVE_FRAMES !== "false"
      }));
    }

    const liveFrameMatch = /^\/v1\/tasks\/([^/]+)\/frame$/.exec(url.pathname);
    if (req.method === "GET" && liveFrameMatch) {
      const taskId = liveFrameMatch[1]!;
      if (!runtime.store.get(taskId)) return json(res, 404, { error: "Task not found" });
      const frame = runtime.artifacts.getLiveFrame(taskId);
      if (!frame) return json(res, 404, { error: "No live frame available" });

      const etag = `W/"${frame.metadata.sequence}"`;
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { etag, "cache-control": "no-store" });
        res.end();
        return;
      }

      const data = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
      res.writeHead(200, {
        "content-type": frame.metadata.mimeType,
        "content-length": data.byteLength,
        "cache-control": "no-store",
        etag,
        "x-owr-frame-sequence": String(frame.metadata.sequence),
        "x-owr-captured-at": frame.metadata.capturedAt,
        "x-content-type-options": "nosniff"
      });
      res.end(data);
      return;
    }

    const artifactMatch = /^\/v1\/artifacts\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && artifactMatch) {
      const artifact = runtime.artifacts.get(artifactMatch[1]!);
      if (!artifact) return json(res, 404, { error: "Artifact not found" });
      const data = Buffer.from(artifact.data.buffer, artifact.data.byteOffset, artifact.data.byteLength);
      res.writeHead(200, {
        "content-type": artifact.metadata.mimeType,
        "content-length": data.byteLength,
        "cache-control": "no-store",
        "content-disposition": "inline",
        "x-content-type-options": "nosniff"
      });
      res.end(data);
      return;
    }

    const artifactsMatch = /^\/v1\/tasks\/([^/]+)\/artifacts$/.exec(url.pathname);
    if (req.method === "GET" && artifactsMatch) {
      const taskId = artifactsMatch[1]!;
      if (!runtime.store.get(taskId)) return json(res, 404, { error: "Task not found" });
      return json(res, 200, runtime.artifacts.list(taskId));
    }

    const eventMatch = /^\/v1\/tasks\/([^/]+)\/events$/.exec(url.pathname);
    if (req.method === "GET" && eventMatch) {
      const taskId = eventMatch[1]!;
      const task = runtime.store.get(taskId);
      if (!task) return json(res, 404, { error: "Task not found" });

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
        "x-content-type-options": "nosniff"
      });
      const send = (value: unknown) => res.write(`data: ${JSON.stringify(value)}\n\n`);
      send({ type: "task.snapshot", task });
      const unsubscribe = runtime.events.subscribe(taskId, send);
      const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
      return;
    }

    const approvalMatch = /^\/v1\/tasks\/([^/]+)\/approval$/.exec(url.pathname);
    if (req.method === "POST" && approvalMatch) {
      const taskId = approvalMatch[1]!;
      if (!runtime.store.get(taskId)) return json(res, 404, { error: "Task not found" });
      const body = await readJson(req);
      if (typeof body.approved !== "boolean") return json(res, 400, { error: "approved must be boolean" });
      try {
        runtime.store.resolveApproval(taskId, body.approved);
        return json(res, 200, runtime.store.get(taskId));
      } catch (error) {
        return json(res, 409, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    const taskMatch = /^\/v1\/tasks\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && taskMatch) {
      const task = runtime.store.get(taskMatch[1]!);
      return task ? json(res, 200, task) : json(res, 404, { error: "Task not found" });
    }

    return json(res, 404, { error: "Not found" });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

server.listen(port, host, () => {
  console.log(`Open Web Runtime listening on http://${host}:${port}`);
});
