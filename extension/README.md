# OWR Shared Tab companion extension

This Manifest V3 extension is the easiest path for Instagram, YouTube and X when the video already works in your normal signed-in browser.

It does **not** export cookies, enumerate your browser history, or grant OWR access to every page. Opening the extension popup grants Chrome's temporary `activeTab` permission to the tab you choose. The grant is dropped when that tab navigates or closes.

## Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this `extension/` folder.
4. Start the local MCP bridge:
   `node scripts/tab-share-mcp.mjs`
5. The bridge prints a loopback WebSocket URL and a random pairing token to stderr.
6. Open the exact Instagram Reel/post, YouTube video/Short, or X/Twitter status video you want to inspect and verify it plays normally.
7. Click **OWR Shared Tab**, paste the token, and click **Share current tab**.

The local bridge exposes these MCP tools:

- `shared_tab_status`
- `video_inspect_shared_tab`: seek an accessible HTML video and return timestamped JPEGs + exposed text-track cues.
- `shared_tab_snapshot`: capture one visible frame.
- `shared_tab_burst`: capture multiple visible frames over time without DOM seeking. This is the fallback for players whose DOM video cannot be inspected.
- `shared_tab_audio_clip`: after **you explicitly click Enable audio**, return a bounded 1–30 second WebM/Opus audio clip as an MCP audio block. OWR does not transcribe it.

The extension only connects to `ws://127.0.0.1:*/bridge` or `ws://localhost:*/bridge`, and the bridge listens on loopback only.

## Important limits

This is a visual evidence path, not a bypass. If the browser itself shows login/consent/challenge or cannot play the media, OWR will not defeat it. `shared_tab_burst` captures the visible tab, so private information visible in that tab can appear in returned images. Share only the intended tab, and stop sharing when done.

Audio is **off by default**. Clicking Enable audio asks Chrome at runtime for optional `tabCapture` and `offscreen` permissions. Chrome may show a warning for tabCapture. OWR then captures only the already-shared tab and forwards the captured audio back to your speakers so enabling capture should not intentionally mute the tab. Stop sharing or click Disable audio to stop the stream.

The MCP tool returns base64 audio with its MIME type; transcription is not implemented. Whether an MCP host can reason directly over the returned audio depends on that host's audio-content support. DRM/protected content can still produce blocked capture.

Chrome caps visible-tab capture at 2 calls per second, so OWR burst capture enforces a minimum 500ms interval. The extension's **required** permissions remain only `activeTab` and `scripting`. `tabCapture` and `offscreen` are declared as optional permissions and requested only from the explicit Enable audio click. It does not request `tabs`, `storage`, cookie, history, webRequest, or `<all_urls>` permissions.

## One-command real-site acceptance

After building the repo and loading this extension, run:

```bash
npm run accept:social-video -- \\
  --url 'PASTE_EXACT_INSTAGRAM_YOUTUBE_OR_X_VIDEO_URL' \\
  --times 1,5,10 \\
  --audio-seconds 8 \\
  --out ./acceptance-evidence
```

The command prints the local bridge URL and a one-time pairing token, then waits for you to share the exact tab. It first tries true timestamp sampling. If the player is not DOM-accessible, it falls back to visible-tab burst capture and labels the result partial/inconclusive rather than pretending timestamps were sampled. If audio was requested, it waits for you to explicitly enable audio in the extension and saves the MCP audio block. The output folder contains images/audio plus `report.json` with SHA-256 hashes and the exact evidence status.