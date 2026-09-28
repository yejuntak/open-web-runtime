import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const smokeEmail = "smoke@example.com";
const logs = [];

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP port");
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

async function api(baseUrl, path, init) {
  const response = await fetch(baseUrl + path, init);
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  }
  return response;
}

async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API exited early with code ${child.exitCode}\n${logs.join("")}`);
    try {
      const response = await fetch(baseUrl + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  throw new Error("API did not become healthy\n" + logs.join(""));
}

async function waitForTask(baseUrl, taskId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const task = await (await api(baseUrl, "/v1/tasks/" + encodeURIComponent(taskId))).json();
    if (["completed", "failed", "cancelled"].includes(task.status)) return task;
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  throw new Error("Task did not finish");
}

const fixtureServer = createServer((req, res) => {
  if (req.url === "/next") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Next</title><p>Next page</p>");
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html>
<head>
  <title>Fixture</title>
  <meta name="description" content="OWR browser smoke fixture">
  <link rel="canonical" href="/">
</head>
<body>
  <main>
    <h1>Smoke fixture</h1>
    <label>Email <input id="email" name="email" type="email" autocomplete="off"></label>
    <button id="submit" type="button">Submit</button>
    <p id="status">Idle</p>
    <a href="/next">Next page</a>
  </main>
  <script>
    const input = document.getElementById("email");
    const status = document.getElementById("status");
    document.getElementById("submit").addEventListener("click", () => {
      document.title = "Submitted";
      status.textContent = "Submitted: " + input.value;
    });
  </script>
</body>
</html>`);
});

const auxiliaryServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/search") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        results: [
          { title: "Open Web Runtime", url: "https://example.com/owr", content: "Inspectable browser runtime", engine: "smoke" },
          { title: "Browser Agents", url: "https://example.com/agents", content: "Agent benchmark", engines: ["smoke"] }
        ]
      }));
      return;
    }

    if (req.method === "POST" && (url.pathname === "/chat/completions" || url.pathname === "/responses")) {
      const body = await readJson(req);
      const chatMessage = body?.messages?.at?.(-1)?.content;
      const responseMessage = body?.input?.at?.(-1)?.content?.find?.(item => item?.type === "input_text")?.text;
      const userMessage = typeof chatMessage === "string" ? chatMessage : responseMessage;
      const context = JSON.parse(typeof userMessage === "string" ? userMessage : "{}");
      const nodes = Array.isArray(context?.page?.nodes) ? context.page.nodes : [];
      const title = String(context?.page?.title ?? "");
      const email = nodes.find(node => node.role === "textbox" && node.name === "Email");
      const submit = nodes.find(node => node.role === "button" && node.name === "Submit");

      let action;
      if (title === "Submitted" || String(context?.page?.textPreview ?? "").includes("Submitted:")) {
        action = { type: "complete", result: { ok: true }, summary: "fixture submitted" };
      } else if (email && email.valueLength !== smokeEmail.length) {
        action = { type: "type", nodeId: email.id, text: smokeEmail, submit: false };
      } else if (submit) {
        action = { type: "click", nodeId: submit.id };
      } else {
        action = { type: "wait", ms: 100 };
      }

      res.writeHead(200, { "content-type": "application/json" });
      if (url.pathname === "/responses") {
        res.end(JSON.stringify({
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(action) }] }]
        }));
      } else {
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(action) } }] }));
      }
      return;
    }

    res.writeHead(404);
    res.end("not found");
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

let apiChild;
try {
  const fixturePort = await listen(fixtureServer);
  const auxiliaryPort = await listen(auxiliaryServer);
  const apiPort = await freePort();

  const fixtureUrl = `http://127.0.0.1:${fixturePort}/`;
  const apiBase = `http://127.0.0.1:${apiPort}`;
  const auxiliaryBase = `http://127.0.0.1:${auxiliaryPort}`;

  apiChild = spawn(process.execPath, ["apps/api/dist/server.js"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(apiPort),
      LLM_BASE_URL: auxiliaryBase,
      LLM_API_KEY: "smoke-key",
      LLM_MODEL: "smoke-model",
      LLM_API_MODE: "responses",
      SEARXNG_BASE_URL: auxiliaryBase,
      ALLOW_PRIVATE_NETWORKS: "true",
      CAPTURE_SCREENSHOTS: "true",
      LIVE_FRAMES: "false",
      MAX_AGENT_STEPS: "8",
      MAX_CONSECUTIVE_ACTION_FAILURES: "3",
      MAX_BROWSER_SESSIONS: "4",
      BROWSER_SESSION_TTL_MS: "60000",
      HEADLESS: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  apiChild.stdout.on("data", chunk => logs.push(chunk.toString()));
  apiChild.stderr.on("data", chunk => logs.push(chunk.toString()));

  await waitForHealth(apiBase, apiChild);

  // Real public-web smoke: this leaves the runner and exercises the runtime
  // against an external HTTPS site, not only the local deterministic fixture.
  const publicFetched = await (await api(apiBase, "/v1/fetch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com", settleMs: 0 })
  })).json();
  assert.equal(publicFetched.title, "Example Domain");
  assert.ok(publicFetched.text.length > 50, "Expected rendered public-page text");

  const publicBrowser = await (await api(apiBase, "/v1/browser/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ startUrl: "https://example.com" })
  })).json();
  const publicObservation = await (await api(apiBase, `/v1/browser/sessions/${publicBrowser.id}/observe`)).json();
  assert.ok(publicObservation.title.length > 0, "Expected a public browser page title");
  assert.ok(publicObservation.nodes.some(node => node.role === "link"), "Expected a semantic link on the public page");
  const publicScreenshot = await api(apiBase, `/v1/browser/sessions/${publicBrowser.id}/screenshot`);
  assert.equal(publicScreenshot.headers.get("content-type"), "image/jpeg");
  assert.ok((await publicScreenshot.arrayBuffer()).byteLength > 1000);
  await api(apiBase, `/v1/browser/sessions/${publicBrowser.id}`, { method: "DELETE" });

  const search = await (await api(apiBase, "/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "browser agents", limit: 2 })
  })).json();
  assert.equal(search.provider, "searxng");
  assert.equal(search.results.length, 2);
  assert.equal(search.results[0].sources[0], "smoke");

  const fetched = await (await api(apiBase, "/v1/fetch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: fixtureUrl, settleMs: 0 })
  })).json();
  assert.equal(fetched.title, "Fixture");
  assert.match(fetched.text, /Smoke fixture/);
  assert.match(fetched.description, /browser smoke fixture/);
  assert.equal(fetched.links[0].href, `http://127.0.0.1:${fixturePort}/next`);

  const browserSession = await (await api(apiBase, "/v1/browser/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ startUrl: fixtureUrl })
  })).json();

  let observation = await (await api(apiBase, `/v1/browser/sessions/${browserSession.id}/observe`)).json();
  const emailNode = observation.nodes.find(node => node.role === "textbox" && node.name === "Email");
  const submitNode = observation.nodes.find(node => node.role === "button" && node.name === "Submit");
  assert.ok(emailNode, "Email semantic node was not found");
  assert.ok(submitNode, "Submit semantic node was not found");

  await api(apiBase, `/v1/browser/sessions/${browserSession.id}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: { type: "type", nodeId: emailNode.id, text: smokeEmail, submit: false } })
  });
  await api(apiBase, `/v1/browser/sessions/${browserSession.id}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: { type: "click", nodeId: submitNode.id } })
  });
  await api(apiBase, `/v1/browser/sessions/${browserSession.id}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: { type: "wait", ms: 100 } })
  });

  observation = await (await api(apiBase, `/v1/browser/sessions/${browserSession.id}/observe`)).json();
  assert.equal(observation.title, "Submitted");
  assert.match(observation.textPreview, /Submitted: smoke@example\.com/);

  const screenshot = await api(apiBase, `/v1/browser/sessions/${browserSession.id}/screenshot`);
  assert.equal(screenshot.headers.get("content-type"), "image/jpeg");
  assert.ok((await screenshot.arrayBuffer()).byteLength > 1000);

  await api(apiBase, `/v1/browser/sessions/${browserSession.id}`, { method: "DELETE" });

  const createdTask = await (await api(apiBase, "/v1/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Fill the Email field with the smoke-test value, press Submit, and finish.",
      startUrl: fixtureUrl,
      autoRun: true
    })
  })).json();

  assert.match(createdTask.inspectorUrl, new RegExp(createdTask.id));

  const task = await waitForTask(apiBase, createdTask.id);
  assert.equal(task.status, "completed", JSON.stringify(task, null, 2));
  assert.deepEqual(task.result, { ok: true });
  assert.ok(task.steps.some(step => step.action.type === "type"));
  assert.ok(task.steps.some(step => step.action.type === "click"));

  const artifacts = await (await api(apiBase, `/v1/tasks/${createdTask.id}/artifacts`)).json();
  assert.ok(artifacts.length >= 1);
  assert.match(artifacts[0].sha256, /^[a-f0-9]{64}$/);

  const manifest = await (await api(apiBase, `/v1/tasks/${createdTask.id}/export`)).json();
  assert.equal(manifest.schemaVersion, "owr.run.v1");
  assert.equal(JSON.stringify(manifest).includes(smokeEmail), false);
  assert.equal(manifest.task.browser.debugUrl, undefined);

  const inspector = await api(apiBase, `/inspect/${createdTask.id}`);
  assert.match(await inspector.text(), /Open Web Runtime Inspector/);

  console.log("E2E smoke passed: public HTTPS, Search, Fetch, Browser, Agent, artifacts, manifest, and Inspector.");
} catch (error) {
  console.error(error);
  if (logs.length) console.error("\nAPI logs:\n" + logs.join(""));
  process.exitCode = 1;
} finally {
  if (apiChild && apiChild.exitCode === null) {
    apiChild.kill("SIGTERM");
    await new Promise(resolve => {
      apiChild.once("exit", resolve);
      setTimeout(resolve, 1500).unref();
    });
  }
  await Promise.all([closeServer(fixtureServer), closeServer(auxiliaryServer)]);
}
