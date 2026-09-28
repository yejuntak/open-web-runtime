# Open Web Runtime

An open, inspectable web execution runtime for AI agents.

**Status:** v0.1 experimental

Open Web Runtime converts a natural-language goal into bounded semantic observations and typed browser actions. Planning, policy, browser infrastructure, and task state are separate layers so each can be replaced independently.

> Independent clean-room implementation. Not affiliated with TinyFish. See [CLEAN_ROOM.md](./CLEAN_ROOM.md).

## Why

Browser agents are easier to trust and debug when the execution loop is visible:

```text
Goal
  |
  v
Planner
  |
  v
Typed AgentAction
  |
  v
Policy Gate
  |
  v
BrowserSession
  |
  +---- Local Chromium
  +---- Remote CDP
  |
  v
CDP DOMSnapshot + Accessibility Tree + Layout
  |
  v
Semantic Page Graph
  |
  v
Trace / SSE / Result
```

The planner never gets arbitrary JavaScript or a raw Playwright handle. It receives a bounded semantic graph and can return only the runtime action contract. Failed actions are classified into structured failure codes; the planner may recover from a fresh observation, but the runtime stops after `MAX_CONSECUTIVE_ACTION_FAILURES` consecutive failures (default 3) rather than blindly replaying side-effecting actions.

## Four primitives

### Search

Search is provider-driven. The first adapter targets an operator-supplied SearXNG instance; no search engine is bundled into this repository.

```bash
SEARXNG_BASE_URL=https://your-search.example
./packages/cli/dist/index.js search --query "browser agent benchmarks" --limit 5
```

### Fetch

Fetch renders a URL in Chromium and returns bounded text, page metadata, and normalized links without invoking an LLM.

```bash
./packages/cli/dist/index.js fetch --url https://example.com
```

Fetch uses the same navigation policy as Agent and rejects private/local network destinations by default.

### Agent

Agent converts a goal into typed actions over the Semantic Page Graph. Every step is policy-checked, traced, and visible in the Inspector.

```bash
./packages/cli/dist/index.js run \
  --goal "Return the primary call to action as JSON." \
  --url https://example.com
```

### Browser

Browser exposes managed sessions for clients that want direct control while keeping OWR's policy layer.

```bash
curl -X POST http://localhost:8787/v1/browser/sessions \
  -H 'content-type: application/json' \
  -d '{"startUrl":"https://example.com"}'
```

Then observe or submit typed actions through `/v1/browser/sessions/:id/observe` and `/v1/browser/sessions/:id/actions`. Sessions are serialized, bounded in number, and expire by TTL.

## Current capabilities

- Search provider contract and SearXNG HTTP adapter
- rendered Fetch primitive
- managed direct Browser sessions
- natural-language browser task loop
- OpenAI-compatible planner adapter
- local Chromium browser backend
- remote CDP browser backend
- semantic observations from Chromium `DOMSnapshot.captureSnapshot`
- accessibility-tree semantics
- layout/bounding boxes
- typed `navigate`, `click`, `type`, `select`, `press`, `scroll`, `wait`, and `complete` actions
- private/local network blocking by default
- human approval gate for consequential controls
- REST task API
- SSE event stream
- optional bearer-token API protection
- TypeScript SDK and `owr` CLI
- Docker image
- tests and GitHub Actions

Semantic IDs such as `b44` are derived from Chromium backend DOM identities. Observation does not inject private attributes into the target page.

## ChatGPT / Codex MCP mode — no OpenAI API key required

This is the intended TinyFish-replacement path. ChatGPT or Codex is the planner; Open Web Runtime only executes web tools. The MCP endpoint is:

```text
/mcp
```

For this mode, set `MCP_ONLY=true` and leave `LLM_API_KEY` empty. MCP-only mode exposes only `/health` and `/mcp`; the standalone Agent/Inspector REST surface is not reachable. Start the runtime, expose it through a stable HTTPS endpoint or Secure MCP Tunnel, then connect that HTTPS `/mcp` URL once in ChatGPT developer mode. After the plugin is connected, the host model can call `web_fetch`, `web_search`, and the `browser_*` tools directly.

The repository includes `plugin.json`, `skills/open-web-browser/SKILL.md`, and `mcp.example.json` as the portable plugin package starting point. Deployment and ChatGPT connection steps are in [`docs/DEPLOY_CHATGPT.md`](./docs/DEPLOY_CHATGPT.md).

## Standalone Agent mode — optional API key

The REST `/v1/tasks` Agent endpoint is optional. It runs its own planner and therefore needs an LLM API key. You do not need this endpoint when ChatGPT/Codex is connected through MCP.

## Quick start

Node 22+ and Chrome/Chromium are required for local mode.

```bash
npm ci
cp .env.example .env
```

For MCP mode, no model credential is required:

```bash
LLM_API_KEY=
```

Only if you also want the optional standalone Agent endpoint, set `LLM_API_KEY`.

For the default standalone OpenAI configuration, `LLM_API_MODE=responses` and `LLM_MODEL=gpt-5.6` are used. Current OpenAI flagship models are documented for the Responses API. For providers exposing the older OpenAI-compatible Chat Completions surface, set:

```bash
LLM_API_MODE=chat_completions
LLM_BASE_URL=https://your-provider.example/v1
LLM_MODEL=your-model
```

For local browser execution you can either install the Playwright-managed Chromium with `npx playwright install chromium`, or set `CHROME_EXECUTABLE_PATH` to an existing compatible Chrome/Chromium binary.

Then:

```bash
npm run dev
```

The API listens on `http://localhost:8787` by default.

## Docker

Build locally:

```bash
cp .env.example .env
# LLM_API_KEY may stay empty for MCP mode
docker compose up --build
```

Or run the published GHCR image:

```bash
docker run --rm -p 8787:8787 \
  --shm-size=1g \
  -e HOST=0.0.0.0 \
  -e LLM_API_KEY= \
  ghcr.io/yejuntak/open-web-runtime:latest
```

`main` and `v*` tags are automatically published to GitHub Container Registry by GitHub Actions. See `docker-compose.mcp.yml` for a no-key MCP deployment.

The image installs Chromium and sets `CHROME_EXECUTABLE_PATH=/usr/bin/chromium`.

## Create a task

```bash
curl -X POST http://localhost:8787/v1/tasks \
  -H 'content-type: application/json' \
  -d '{
    "goal": "Find the primary call to action and return its label as JSON.",
    "startUrl": "https://example.com",
    "autoRun": true
  }'
```

Fetch state:

```bash
curl http://localhost:8787/v1/tasks/<task-id>
```

## Live inspector

Open:

```text
http://localhost:8787/inspect/<task-id>
```

The inspector shows the latest Chromium screencast frame, browser backend, run result, step trace, and human-approval controls. Live frames are ephemeral: only the newest screencast frame is kept in memory. Step screenshots are stored separately in a bounded in-memory artifact store.

Disable either channel when handling sensitive workflows:

```bash
LIVE_FRAMES=false
CAPTURE_SCREENSHOTS=false
```

Stream events:

```bash
curl -N http://localhost:8787/v1/tasks/<task-id>/events
```

Approve a consequential action:

```bash
curl -X POST http://localhost:8787/v1/tasks/<task-id>/approval \
  -H 'content-type: application/json' \
  -d '{"approved": true}'
```

## API authentication

Set `OWR_API_TOKEN` to require:

```http
Authorization: Bearer <token>
```

on every endpoint except `/health`.

This is a minimal deployment guard, not a complete multi-tenant authentication system.

## Remote browser

If you already operate a browser service exposing a Chrome DevTools Protocol endpoint:

```bash
REMOTE_CDP_URL=wss://your-browser/cdp
npm run dev
```

This keeps the browser provider independent from any single hosted browser vendor.

## Action contract

Examples:

```json
{"type":"click","nodeId":"b44"}
```

```json
{"type":"type","nodeId":"b51","text":"Open source browser agents","submit":true}
```

```json
{"type":"complete","result":{"answer":"..."},"summary":"Done"}
```

Actions referencing semantic nodes are checked against the latest observation. The runtime rejects missing/disabled nodes, and potentially consequential labels such as `Place order`, `Pay`, `Transfer`, `Delete`, or `Submit application` pause for approval.

## Repository layout

```text
apps/api/
  REST + SSE server

packages/core/
  task runtime
  planner interface
  policy layer
  event bus
  task store
  action types

packages/search/
  provider contract adapter for SearXNG

packages/sdk/
  TypeScript API + SSE client

packages/cli/
  command-line client

packages/browser/
  CDP semantic graph
  local Chromium provider
  remote CDP provider
  Playwright action executor

docs/
  architecture
  roadmap
```

## SDK

```ts
import { OWRClient, waitForTask } from "@owr/sdk";

const client = new OWRClient({
  baseUrl: "http://localhost:8787",
  token: process.env.OWR_API_TOKEN
});

const task = await client.createTask({
  goal: "Return the page title as JSON.",
  startUrl: "https://example.com"
});

console.log(await waitForTask(client, task.id));
```

## CLI

```bash
npm run build
./packages/cli/dist/index.js run \
  --goal "Return the page title as JSON." \
  --url https://example.com
```

Approval flow:

```bash
./packages/cli/dist/index.js get --task <id>
./packages/cli/dist/index.js approve --task <id>
# or
./packages/cli/dist/index.js deny --task <id>
```

## Run manifest

Export a redacted, checksum-backed execution manifest:

```bash
./packages/cli/dist/index.js export --task <id>
```

The manifest includes the task trace, browser backend, artifact metadata and SHA-256 checksums. Typed text, select values, URL credentials/query strings, and browser debug URLs are excluded from the persisted trace/export path.

## Development

```bash
npm ci
npm run typecheck
npm test
```

CI also runs `npm run test:e2e` against a real Playwright Chromium instance. The smoke flow exercises Search, rendered Fetch, direct Browser sessions, semantic input/click execution, screenshot capture, the Agent planner loop, artifact checksums, run-manifest export, and the Inspector route.

## Clean-room policy

The project does not vendor TinyFish code and does not use TinyFish hosted-service traces as implementation or training material. Public product behavior is treated only as a high-level interoperability reference.

See [CLEAN_ROOM.md](./CLEAN_ROOM.md) and [THIRD_PARTY.md](./THIRD_PARTY.md).

## Roadmap

The next reliability milestones are:

- page-diff observations
- cross-navigation semantic identity matching
- stronger iframe and shadow-root fixtures
- run artifacts and screenshots
- durable task storage
- BrowserGym/WebArena evaluation
- worker/concurrency layer
- encrypted browser profiles
- production OAuth for public MCP deployments

See [docs/ROADMAP.md](./docs/ROADMAP.md).

## License

Apache License 2.0.


## MCP authentication note

`OWR_API_TOKEN` is not ChatGPT MCP OAuth. It can protect direct REST/MCP requests from ordinary HTTP clients, but ChatGPT does not accept an arbitrary customer API key as the authentication contract for a published custom MCP server. For local/private development, use Secure MCP Tunnel. For a public write-capable deployment, implement MCP-compatible OAuth 2.1 before exposing browser actions.