# Instagram, YouTube and X: inspect an authorized open tab

## Why this path exists

Anonymous hosted browser probes did not establish public platform playback: YouTube requested sign-in/bot verification, and X returned HTTP 403. Instagram had not been verified. More screenshots of those pages are not proof of video access.

The new adapter inspects a video the operator has already opened and can play in a dedicated local Chrome/Chromium browser. It does not create a fresh browser context or transfer login cookies. It is a local execution option, not an installed ChatGPT connection or a promise every platform video works.

## Run it

From the checked-out repository:

```bash
npm ci
npm run build
```

Open a **dedicated** Chrome profile with debugging bound to loopback. Example for macOS with Chrome installed:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.owr/video-profile"
```

For Linux, replace the executable with your installed `google-chrome` or `chromium`; for Windows use the installed `chrome.exe` and a dedicated directory. Do not use your default profile, publish port 9222, disable browser security, or copy cookies to a cloud server. CDP is a powerful debugging interface, not a security sandbox. Close the dedicated browser when finished.

In that window, sign in normally when the platform requires it, open the intended video, and verify that it plays. Complete any consent/authentication yourself. Do not proceed if the account cannot legitimately access the content.

Then run:

```bash
node scripts/inspect-open-video.mjs \
  --url 'PASTE_THE_EXACT_VIDEO_PERMALINK' \
  --times 0.2,1,2 \
  --out ./video-evidence
```

Supported permalink identification: Instagram reel/post URLs; YouTube watch/shorts/embed/live URLs and youtu.be links; X and twitter.com status URLs. This is URL matching, not a claim that every format/player is supported. Live streams, encrypted media, unloaded players and inaccessible content are not supported by this sampling path. Every timestamp must be below the loaded video's duration.

The command selects exactly one matching open tab and brings it to the foreground. It will not navigate a tab, sign in, read/export cookies, fetch raw signed media URLs, or close your existing tabs. Sampling temporarily seeks/pauses the video and attempts to restore playback state. It leaves the selected tab foregrounded. Duplicated matching tabs and ambiguous players fail instead of choosing arbitrarily; `--player 'Exact player label'` can disambiguate a player.

Output: actual JPEG frames and `report.json`, labeled `passed`, `partial`, or `failed`. Captions already exposed by the player accompany matching samples. Audio is not transcribed; images are sparse samples, not complete viewing. Inspect the actual images before making visual claims.

## Local MCP client

Use a compatible local MCP host with the repository built. Replace the absolute path below; no model API key is needed:

```json
{
  "mcpServers": {
    "owr-open-video": {
      "command": "node",
      "args": ["/ABSOLUTE_PATH/open-web-runtime/scripts/open-tab-mcp.mjs"],
      "env": { "OWR_LOCAL_CDP": "http://127.0.0.1:9222" }
    }
  }
}
```

The tool is `video_inspect_open_tab`, with `url`, `timestamps`, and optional `player_label`. It returns timestamp metadata plus actual inline MCP image blocks. Only authorize a call for the specific video requested. This local stdio server does not install itself into ChatGPT or let a remote client reach localhost; an explicitly authorized client/bridge remains required. Do not tunnel the raw CDP port.

## Evidence and limits

The adapter passed a real-Chromium local MCP test with empty model keys. The test used a project-owned offline video and a synthetic cookie. It verified three distinct frames, checksums, playback restoration, preservation of the existing browser and an unrelated tab, retention of the cookie only in the browser, and refusal of duplicate/missing tabs and non-loopback endpoints. This is evidence of correct session reuse, not successful live Instagram/YouTube/X playback. Actual platform acceptance must run in the intended authorized environment with the intended URLs.

## Additional routes, not implemented by this adapter

- Existing default-profile integration: Microsoft's Playwright extension provides user-approved tab selection and reuses logged-in browser state. This is a reference integration option, not a claim OWR has implemented that extension protocol.
- User-approved tab capture: Chrome tabCapture or getDisplayMedia can provide visible-tab media when DOM-level video extraction is unsuitable. It requires a user gesture; DRM/restrictions can prevent capture. OWR has not yet implemented this fallback or audio transcription.
- Optional direct extraction: yt-dlp includes extractors for all three platforms, but inclusion is not a guarantee of success. Use only for media you are authorized to retrieve. Keep any explicitly authorized browser-cookie use local. Do not upload cookies.txt or send credentials to an AI model.

Primary references:
- https://playwright.dev/mcp/configuration/browser-extension
- https://github.com/microsoft/playwright/blob/main/packages/extension/README.md
- https://developer.chrome.com/blog/remote-debugging-port
- https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- https://github.com/yt-dlp/yt-dlp/wiki/FAQ
- https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md
