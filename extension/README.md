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

The extension only connects to `ws://127.0.0.1:*/bridge` or `ws://localhost:*/bridge`, and the bridge listens on loopback only.

## Important limits

This is a visual evidence path, not a bypass. If the browser itself shows login/consent/challenge or cannot play the media, OWR will not defeat it. `shared_tab_burst` captures the visible tab, so private information visible in that tab can appear in returned images. Share only the intended tab, and stop sharing when done.

Audio transcription is not implemented in this extension version. DRM/protected content can still produce black or blocked captures.

Chrome caps visible-tab capture at 2 calls per second, so OWR burst capture enforces a minimum 500ms interval. The extension intentionally requests only `activeTab` and `scripting`; it does not request `tabs`, `storage`, `tabCapture`, or `<all_urls>` permissions.