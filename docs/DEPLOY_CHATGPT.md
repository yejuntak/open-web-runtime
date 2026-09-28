# Deploy Open Web Runtime for ChatGPT

The intended architecture is:

```text
ChatGPT / Codex
      |
      | MCP
      v
https://your-host.example/mcp
      |
Open Web Runtime
      |
Chromium
```

The host model is the planner. Open Web Runtime does not need an OpenAI API key in MCP mode.

## Option A — local/private server

Run:

```bash
npm ci
npx playwright install chromium
cp .env.example .env
npm run build
npm run dev
```

Leave:

```bash
LLM_API_KEY=
```

ChatGPT cannot connect directly to localhost. OpenAI's current guidance is to use Secure MCP Tunnel for an MCP server on a developer machine or private network.

Connect the resulting secure HTTPS MCP URL, ending in `/mcp`, as a custom app in ChatGPT developer mode.

## Option B — Railway

This repository contains `railway.json` and a production Dockerfile.

Create a Railway service from:

```text
https://github.com/yejuntak/open-web-runtime
```

Railway will use the root Dockerfile. The checked-in configuration uses `/health` as the deploy health check.

MCP mode does not require these:

```text
LLM_API_KEY
LLM_MODEL
LLM_BASE_URL
```

Recommended runtime variables:

```text
MCP_ONLY=true
HEADLESS=true
ALLOW_PRIVATE_NETWORKS=false
MAX_BROWSER_SESSIONS=4
BROWSER_SESSION_TTL_MS=300000
CAPTURE_SCREENSHOTS=false
LIVE_FRAMES=false
```

Do not expose an unauthenticated write-capable MCP server publicly for production. `OWR_API_TOKEN` is not a substitute for ChatGPT MCP authentication. For a durable shared deployment, add MCP-compatible OAuth 2.1 before enabling browser write actions.

## Connect in ChatGPT

Current OpenAI workflow:

1. Enable Developer mode for an eligible account/workspace.
2. Open Settings / Workspace Settings → Apps → Create.
3. Enter the remote MCP endpoint:
   `https://YOUR-HOST/mcp`.
4. Select the appropriate authentication mechanism.
5. Scan tools.
6. Create the draft app.
7. Start a new chat and select or @mention the app when the message needs new browser execution.

The server exposes:

- `web_search`
- `web_fetch`
- `browser_open`
- `browser_sessions`
- `browser_observe`
- `browser_navigate`
- `browser_click`
- `browser_type`
- `browser_select`
- `browser_press`
- `browser_scroll`
- `browser_wait`
- `browser_screenshot`
- `browser_close`

`browser_click` preserves Open Web Runtime's consequential-action gate. If it returns `confirmationRequired`, the host model should ask the user before retrying with `confirmed=true`.

## Plan limitation

ChatGPT availability for custom MCP actions is controlled by ChatGPT itself. OpenAI's current documentation says full MCP, including write/modify actions, is available to Business and Enterprise/Edu, while Pro custom MCP access can be limited to read/fetch permissions. This repository cannot bypass those product permissions.
