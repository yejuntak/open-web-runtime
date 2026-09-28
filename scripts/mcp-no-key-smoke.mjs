import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const logs = [];

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP address");
  return address.port;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise(resolve => server.close(resolve));
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error("API exited early\n" + logs.join(""));
    try {
      const response = await fetch(baseUrl + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  throw new Error("API did not become healthy\n" + logs.join(""));
}

const fixtureServer = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<title>MCP Fixture</title>
<label>Email <input name="email" aria-label="Email"></label>
<button id="go">Continue</button>
<p id="status">Idle</p>
<script>
document.getElementById("go").addEventListener("click", () => {
  document.title = "MCP Done";
  document.getElementById("status").textContent = "Done";
});
</script>`);
});

let child;
let client;
try {
  const fixturePort = await listen(fixtureServer);
  const apiPort = await freePort();
  const baseUrl = `http://127.0.0.1:${apiPort}`;
  const fixtureUrl = `http://127.0.0.1:${fixturePort}/`;

  child = spawn(process.execPath, ["apps/api/dist/server.js"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(apiPort),
      MCP_ONLY: "true",
      LLM_API_KEY: "",
      SEARXNG_BASE_URL: "",
      ALLOW_PRIVATE_NETWORKS: "true",
      HEADLESS: "true",
      CAPTURE_SCREENSHOTS: "false",
      LIVE_FRAMES: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", chunk => logs.push(chunk.toString()));
  child.stderr.on("data", chunk => logs.push(chunk.toString()));

  await waitForHealth(baseUrl, child);

  const hiddenRest = await fetch(baseUrl + "/");
  assert.equal(hiddenRest.status, 404, "MCP-only mode should hide REST routes");

  client = new Client(
    { name: "owr-mcp-smoke", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } }
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl + "/mcp")));

  const tools = await client.listTools();
  const names = new Set(tools.tools.map(tool => tool.name));
  for (const required of [
    "web_fetch",
    "browser_open",
    "browser_observe",
    "browser_type",
    "browser_click",
    "browser_screenshot",
    "browser_close"
  ]) {
    assert.ok(names.has(required), `Missing MCP tool: ${required}`);
  }

  const fetched = await client.callTool({
    name: "web_fetch",
    arguments: { url: fixtureUrl, settle_ms: 0 }
  });
  assert.equal(fetched.isError, undefined);
  assert.match(fetched.content?.find(block => block.type === "text")?.text ?? "", /MCP Fixture/);

  const opened = await client.callTool({
    name: "browser_open",
    arguments: { start_url: fixtureUrl }
  });
  const openData = opened.structuredContent;
  const sessionId = openData?.session?.id;
  assert.equal(typeof sessionId, "string");

  const observed = await client.callTool({
    name: "browser_observe",
    arguments: { session_id: sessionId }
  });
  const observation = observed.structuredContent?.observation;
  const email = observation?.nodes?.find(node => node.role === "textbox" && node.name === "Email");
  const button = observation?.nodes?.find(node => node.role === "button" && node.name === "Continue");
  assert.ok(email?.id);
  assert.ok(button?.id);

  const typed = await client.callTool({
    name: "browser_type",
    arguments: {
      session_id: sessionId,
      node_id: email.id,
      text: "mcp@example.com",
      submit: false
    }
  });
  assert.equal(typed.isError, undefined);

  const clicked = await client.callTool({
    name: "browser_click",
    arguments: {
      session_id: sessionId,
      node_id: button.id
    }
  });
  assert.equal(clicked.isError, undefined);

  const after = await client.callTool({
    name: "browser_observe",
    arguments: { session_id: sessionId }
  });
  assert.equal(after.structuredContent?.observation?.title, "MCP Done");

  const screenshot = await client.callTool({
    name: "browser_screenshot",
    arguments: { session_id: sessionId }
  });
  assert.ok(screenshot.content?.some(block => block.type === "image"));

  await client.callTool({
    name: "browser_close",
    arguments: { session_id: sessionId }
  });

  assert.equal(process.env.LLM_API_KEY, undefined);
  console.log("MCP no-key smoke passed: host model can drive OWR browser tools without an OpenAI API key.");
} catch (error) {
  console.error(error);
  if (logs.length) console.error("\nAPI logs:\n" + logs.join(""));
  process.exitCode = 1;
} finally {
  await client?.close().catch(() => undefined);
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => {
      child.once("exit", resolve);
      setTimeout(resolve, 1500).unref();
    });
  }
  await closeServer(fixtureServer);
}
