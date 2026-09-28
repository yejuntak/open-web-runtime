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

The planner never gets arbitrary JavaScript or a raw Playwright handle. It receives a bounded semantic graph and can return only the runtime action contract.

## Current capabilities

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
- Docker image
- tests and GitHub Actions

Semantic IDs such as `b44` are derived from Chromium backend DOM identities. Observation does not inject private attributes into the target page.

## Quick start

Node 22+ and Chrome/Chromium are required for local mode.

```bash
npm install
cp .env.example .env
```

Set at minimum:

```bash
LLM_API_KEY=...
CHROME_EXECUTABLE_PATH=/path/to/chrome
```

Then:

```bash
npm run dev
```

The API listens on `http://localhost:8787` by default.

## Docker

```bash
cp .env.example .env
# add LLM_API_KEY
docker compose up --build
```

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

packages/browser/
  CDP semantic graph
  local Chromium provider
  remote CDP provider
  Playwright action executor

docs/
  architecture
  roadmap
```

## Development

```bash
npm run typecheck
npm test
```

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
- MCP and SDK packages

See [docs/ROADMAP.md](./docs/ROADMAP.md).

## License

Apache License 2.0.
