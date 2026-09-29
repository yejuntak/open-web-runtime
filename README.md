# Open Web Runtime

A no-model-key browser execution layer for MCP clients, with semantic controls and timestamped video evidence.

**Status: developer preview, not a production-complete TinyFish replacement.** Passing fixture tests does not certify YouTube/X access or an installed ChatGPT connection. See [readiness and acceptance evidence](docs/READINESS.md).

The host model (for example ChatGPT or Codex) plans. OWR performs browser operations and returns text and images. **MCP does not require an OpenAI API key.** An optional standalone Agent endpoint uses its own model credentials; it is not needed for MCP.

## Local MCP: no cloud hosting

Node 22+ is required. In a trusted, isolated development environment:

```bash
npm ci
npm run build
npx playwright install chromium
node scripts/configure-client.mjs
```

The last command prints a client configuration with absolute paths. Add it to a stdio-capable MCP client and authorize the tools there. The server entry is `apps/api/dist/stdio.js`; run it with `node`, not an npm wrapper that might print banners to the protocol stream.

A root `mcp.json` is also included for local plugin hosts that support the Agent Plugins convention and `${PLUGIN_ROOT}` working directories. Dependencies, built output, and Chromium must exist before installation. A ZIP/repository alone does not execute code or authorize a new ChatGPT tool.

## Remote MCP

```bash
cp .env.example .env
# Leave LLM_API_KEY empty. Set HOST=127.0.0.1 and MCP_ONLY=true.
npm run dev
```

The endpoint is `/mcp`. `npm run dev` builds workspace packages and loads `.env`; `npm start` loads `.env` after an existing build. A remote client needs an authorized connection to a running HTTPS server or supported secure tunnel. See [connection guide](docs/DEPLOY_CHATGPT.md).

**Do not expose this preview as an unauthenticated public browser service.** MCP_ONLY hides other routes but is not authentication, network isolation, or tenant isolation. URL checks are not a complete SSRF defense. Use isolated hosts with externally enforced outbound network restrictions. See [SECURITY.md](SECURITY.md).

## Tools

| Area | Tools |
|---|---|
| Capability inspection | `runtime_info` |
| Reading and discovery | `web_fetch`, `web_search` (operator-supplied search provider) |
| Browser sessions | `browser_open`, `browser_sessions`, `browser_observe`, `browser_navigate`, `browser_close` |
| Interactions | `browser_click`, `browser_type`, `browser_select`, `browser_press`, `browser_scroll`, `browser_wait` |
| Visual evidence | `browser_screenshot`, `video_list`, `video_sample`, `video_captions` |

Node IDs come from the latest semantic observation. Video IDs come from video_list and are invalidated by the next list. Clicks and form/key actions may require explicit confirmation. Tools are not an authorization substitute for the user.

## Video inspection

`browser_open` -> `video_list` -> `video_sample` -> inspect returned images -> `video_captions` -> `browser_close`.

Video sampling returns actual JPEG image blocks, requested/actual timestamps, SHA-256 checksums, available caption cues, partial failures, and playback-restoration status. It handles discovered HTML players in main frames, embedded frames, and open shadow roots.

This is **sparse visual sampling**, not continuous watching. It does not transcribe audio, recover unavailable subtitles, bypass DRM, log in automatically, or guarantee access to YouTube/X. A player must already be accessible and loaded in the browser session. [Video contract](docs/VIDEO.md).

## Tests

```bash
npm run typecheck
npm test
npm run test:e2e
npm run test:mcp
# FFmpeg is required to create our own synthetic test video:
npm run test:video
npm run test:media
# External, environment-dependent diagnostic; failures remain failures:
npm run test:public-video
```

Media Acceptance exercises actual Chromium and both HTTP/stdio MCP transports with empty model keys. It records JPEG frames and machine-readable reports in GitHub Actions artifacts. Its synthetic fixture does not establish public-site compatibility.

The public-video probe records actual selected YouTube/X attempts separately. The initial probe at commit d9c9c5d failed: YouTube required sign-in/bot verification, and the X page exposed no playable video. See [readiness](docs/READINESS.md) for exact evidence.

## Other interfaces

The existing REST API, TypeScript SDK, CLI, Search adapter, step artifacts, Inspector, and optional standalone Agent remain in this repository. MCP_ONLY hides REST/Inspector routes. State is in-memory. Run manifests contain redacted execution records and checksums, not deterministic replay of the changing web.

Dockerfile, Railway configuration, and GHCR publishing exist, but container publication is not a running service or installed ChatGPT connection. Chromium execution inside the packaged image needs its own test; an MCP initialize response alone does not prove it.

## License and provenance

Apache-2.0. Independent clean-room implementation; no proprietary TinyFish implementation or hosted-service trajectories are used. See [CLEAN_ROOM.md](CLEAN_ROOM.md) and [THIRD_PARTY.md](THIRD_PARTY.md).
