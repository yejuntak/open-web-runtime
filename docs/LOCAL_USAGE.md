# Use the runtime without a second model account

## Direct video inspection from a trusted local checkout

```bash
npm ci
npm run build
npx playwright install chromium
node scripts/inspect-video.mjs \
  --url 'https://www.youtube.com/watch?v=YOUR_VIDEO_ID' \
  --times 1,5,10 \
  --out ./video-evidence
```

This command uses the real local MCP server and official client. It starts no external model and sets model keys empty. It writes actual JPEG frames plus `report.json`. The output reports `passed`, `partial`, or `failed`; a blocked/unloaded player is not called success. Timestamps must be below the detected duration. When multiple players exist, `--player 'Exact accessible label'` can select a unique intended player; the runtime does not guess which ad or video you meant.

The command does not log into YouTube/X, bypass challenges, hear audio, or watch every frame. It only samples accessible loaded players. The initial public hosted-runner attempts failed, as recorded in READINESS.md. An authorized environment must be tested with the intended real URLs before claiming support.

## Connect a local MCP host

```bash
node scripts/configure-client.mjs
```

Add the printed absolute-path configuration to a compatible local client and authorize the tools there. The host model uses browser and video tools for reasoning. A local stdio connection needs neither Railway nor an OpenAI API key.

## Actual execution in the assistant's restricted environment

The built runtime from the GitHub Actions artifact for commit `3e7034e6d8203f8f1e82bc8343b3c0e45b104e41` was executed through its real MCP HTTP interface and real Chromium. Browser network navigation was restricted by the execution environment, so an owned offline fixture was used rather than bypassing that restriction.

Observed result: three actual images at 0.2, 1.4, and 2.8 seconds; two exposed caption cues; verified image checksums; playback restored; no model API key. The returned images were inspected. This is real runtime execution, but it is **not** a native installed ChatGPT app or evidence of successful public YouTube/X playback.

Reproduce the offline test with FFmpeg available:

```bash
CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
  LLM_API_KEY= OPENAI_API_KEY= \
  node scripts/mcp-offline-media-smoke.mjs
```

The path above is the Linux system Chromium example; omit it when using Playwright-managed Chromium. The test uses a generated, project-owned media fixture and no browser network navigation.

## Definition of complete

Client installation, successful intended public-site playback, temporal coverage, audio requirements, and deployment security are separate acceptance gates. See READINESS.md. Do not substitute a successful build, a server handshake, or synthetic fixture for those gates.
