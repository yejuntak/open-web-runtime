import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";
import {
  redactUrlForTrace,
  type BrowserActionResult,
  type BrowserSessionMetadata,
  type BrowserSessionRegistry,
  type PageObservation,
  type SearchProvider,
  type WebFetcher
} from "@owr/core";

export type OpenWebMcpDependencies = {
  webFetcher: WebFetcher;
  searchProvider?: SearchProvider;
  browserSessions: BrowserSessionRegistry;
};

function textResult(message: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: message }],
    ...(structuredContent ? { structuredContent } : {})
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }]
  };
}

function safeSession(metadata: BrowserSessionMetadata) {
  return {
    id: metadata.id,
    backend: metadata.backend,
    createdAt: metadata.createdAt,
    lastUsedAt: metadata.lastUsedAt
  };
}

function safeObservation(observation: PageObservation) {
  return {
    url: redactUrlForTrace(observation.url),
    title: observation.title,
    timestamp: observation.timestamp,
    textPreview: observation.textPreview.slice(0, 12_000),
    nodes: observation.nodes.slice(0, 180).map(node => ({
      id: node.id,
      semanticKey: node.semanticKey,
      role: node.role,
      name: node.name,
      tag: node.tag,
      text: node.text.slice(0, 300),
      valuePresent: node.value !== undefined && node.value.length > 0,
      valueLength: node.value?.length ?? 0,
      ...(node.href ? { href: redactUrlForTrace(node.href) } : {}),
      disabled: node.disabled,
      visible: node.visible,
      bbox: node.bbox,
      actions: node.actions
    })),
    accessibilitySummary: observation.accessibilitySummary.slice(0, 120)
  };
}

function safeActionResult(result: BrowserActionResult) {
  if (!result.executed) {
    return {
      executed: false as const,
      confirmationRequired: result.confirmationRequired
    };
  }
  return {
    executed: true as const,
    observation: safeObservation(result.observation)
  };
}

function createServer(deps: OpenWebMcpDependencies) {
  const server = new McpServer(
    { name: "open-web-runtime", version: "0.2.0" },
    {
      instructions:
        "Use this server as the web execution layer; the host model is the planner. Use web_fetch for a known page, web_search for discovery, and browser_open + browser_observe + one browser action at a time for interactive sites. Never invent node IDs: use only IDs from the latest observation. Use browser_screenshot when visual context matters. Close sessions when done. If a click returns confirmationRequired, ask the user and retry with confirmed=true only after explicit approval."
    }
  );

  server.registerTool(
    "web_search",
    {
      title: "Search the web",
      description:
        "Search the public web using the configured search provider. Use for discovery when you do not already know the exact URL.",
      inputSchema: z.object({
        query: z.string().min(1).max(1000),
        limit: z.number().int().min(1).max(20).optional()
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ query, limit }) => {
      try {
        if (!deps.searchProvider) {
          return errorResult("Search is not configured on this server. Use web_fetch with a known URL or interactive browser tools.");
        }
        const results = await deps.searchProvider.search(query, limit ?? 8);
        const value = { provider: deps.searchProvider.name, query, results };
        return textResult(JSON.stringify(value), value);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "web_fetch",
    {
      title: "Fetch a rendered web page",
      description:
        "Open a known public URL in Chromium and return rendered text, metadata, and links. Prefer this over an interactive browser session when reading one page is enough.",
      inputSchema: z.object({
        url: z.string().url(),
        settle_ms: z.number().int().min(0).max(5000).optional(),
        max_text_chars: z.number().int().min(1000).max(200000).optional()
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ url, settle_ms, max_text_chars }) => {
      try {
        const document = await deps.webFetcher.fetch({
          url,
          settleMs: settle_ms ?? 300,
          maxTextChars: max_text_chars ?? 60_000
        });
        const value = {
          document: {
            ...document,
            url: redactUrlForTrace(document.url),
            ...(document.canonicalUrl ? { canonicalUrl: redactUrlForTrace(document.canonicalUrl) } : {}),
            links: document.links.map(link => ({
              text: link.text,
              href: redactUrlForTrace(link.href)
            }))
          }
        };
        return textResult(JSON.stringify(value), value);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "browser_open",
    {
      title: "Open browser session",
      description:
        "Create a managed browser session, optionally navigating to a starting URL. Use for interactive or multi-step web tasks.",
      inputSchema: z.object({
        start_url: z.string().url().optional()
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ start_url }) => {
      try {
        const session = await deps.browserSessions.create(start_url);
        const value = { session: safeSession(session) };
        return textResult(JSON.stringify(value), value);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "browser_sessions",
    {
      title: "List browser sessions",
      description: "List currently managed browser sessions on this runtime.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const value = { sessions: deps.browserSessions.list().map(safeSession) };
      return textResult(JSON.stringify(value), value);
    }
  );

  server.registerTool(
    "browser_observe",
    {
      title: "Observe browser page",
      description:
        "Return the current page as a semantic graph. Always call this before acting on a newly opened or changed page. Node IDs are valid only for the latest observed state.",
      inputSchema: z.object({
        session_id: z.string().uuid()
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ session_id }) => {
      try {
        const observation = await deps.browserSessions.observe(session_id);
        const value = { observation: safeObservation(observation) };
        return textResult(JSON.stringify(value), value);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "browser_navigate",
    {
      title: "Navigate browser",
      description: "Navigate an existing browser session to an absolute public HTTP(S) URL, then return the new semantic observation.",
      inputSchema: z.object({
        session_id: z.string().uuid(),
        url: z.string().url()
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ session_id, url }) => {
      try {
        const result = await deps.browserSessions.act(session_id, { type: "navigate", url });
        const value = { result: safeActionResult(result) };
        return textResult(JSON.stringify(value), value);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "browser_click",
    {
      title: "Click browser control",
      description:
        "Click exactly one node ID from the latest browser_observe result. This can trigger external side effects. If the server returns confirmationRequired, stop and ask the user; retry with confirmed=true only after explicit approval.",
      inputSchema: z.object({
        session_id: z.string().uuid(),
        node_id: z.string().min(1),
        confirmed: z.boolean().optional()
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ session_id, node_id, confirmed }) => {
      try {
        const result = await deps.browserSessions.act(session_id, { type: "click", nodeId: node_id }, confirmed === true);
        const value = { result: safeActionResult(result) };
        return textResult(JSON.stringify(value), value);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "browser_type",
    {
      title: "Type into browser control",
      description:
        "Type text into one textbox node from the latest browser_observe result. Text is used for the immediate browser action and is not persisted in OWR step traces.",
      inputSchema: z.object({
        session_id: z.string().uuid(),
        node_id: z.string().min(1),
        text: z.string().max(100000),
        submit: z.boolean().optional()
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ session_id, node_id, text, submit }) => {
      try {
        const result = await deps.browserSessions.act(session_id, {
          type: "type",
          nodeId: node_id,
          text,
          submit: submit === true
        });
        const value = { result: safeActionResult(result) };
        return textResult(JSON.stringify(value), value);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "browser_select",
    {
      title: "Select browser option",
      description: "Set one select/combobox control from the latest browser_observe result.",
      inputSchema: z.object({
        session_id: z.string().uuid(),
        node_id: z.string().min(1),
        value: z.string().max(10000)
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ session_id, node_id, value }) => {
      try {
        const result = await deps.browserSessions.act(session_id, {
          type: "select",
          nodeId: node_id,
          value
        });
        const output = { result: safeActionResult(result) };
        return textResult(JSON.stringify(output), output);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "browser_press",
    {
      title: "Press browser key",
      description:
        "Press one keyboard key or Playwright key chord in the current browser session. Enter may submit forms, so use it only when that effect is intended.",
      inputSchema: z.object({
        session_id: z.string().uuid(),
        key: z.string().min(1).max(100)
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ session_id, key }) => {
      try {
        const result = await deps.browserSessions.act(session_id, { type: "press", key });
        const value = { result: safeActionResult(result) };
        return textResult(JSON.stringify(value), value);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "browser_scroll",
    {
      title: "Scroll browser",
      description: "Scroll the current browser page up or down, then return a fresh semantic observation.",
      inputSchema: z.object({
        session_id: z.string().uuid(),
        direction: z.enum(["up", "down"]),
        amount: z.number().int().min(100).max(5000).optional()
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ session_id, direction, amount }) => {
      try {
        const result = await deps.browserSessions.act(session_id, {
          type: "scroll",
          direction,
          amount: amount ?? 700
        });
        const value = { result: safeActionResult(result) };
        return textResult(JSON.stringify(value), value);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "browser_wait",
    {
      title: "Wait for browser",
      description: "Wait briefly for a dynamic page to update, then return a fresh semantic observation.",
      inputSchema: z.object({
        session_id: z.string().uuid(),
        ms: z.number().int().min(50).max(15000)
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ session_id, ms }) => {
      try {
        const result = await deps.browserSessions.act(session_id, { type: "wait", ms });
        const value = { result: safeActionResult(result) };
        return textResult(JSON.stringify(value), value);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "browser_screenshot",
    {
      title: "See browser screenshot",
      description:
        "Return a JPEG screenshot of the current browser viewport. Use when semantic page data is insufficient or visual/spatial context matters.",
      inputSchema: z.object({
        session_id: z.string().uuid()
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ session_id }) => {
      try {
        const frame = await deps.browserSessions.screenshot(session_id);
        const metadata = {
          sessionId: session_id,
          mimeType: frame.mimeType,
          byteLength: frame.data.byteLength,
          capturedAt: frame.capturedAt ?? new Date().toISOString(),
          ...(frame.url ? { url: redactUrlForTrace(frame.url) } : {})
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(metadata) },
            {
              type: "image" as const,
              data: Buffer.from(frame.data).toString("base64"),
              mimeType: frame.mimeType
            }
          ],
          structuredContent: metadata
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "browser_close",
    {
      title: "Close browser session",
      description: "Close a managed browser session when the interactive task is finished.",
      inputSchema: z.object({
        session_id: z.string().uuid()
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ session_id }) => {
      try {
        const closed = await deps.browserSessions.close(session_id);
        const value = { closed, sessionId: session_id };
        return textResult(JSON.stringify(value), value);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}

export function createOpenWebMcpNodeHandler(deps: OpenWebMcpDependencies) {
  const handler = createMcpHandler(() => createServer(deps));
  return toNodeHandler(handler);
}
