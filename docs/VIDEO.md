# Video evidence contract

## Purpose

Provide the host model with actual visual observations of accessible HTML videos without a second model account. Do not conflate reading page metadata, seeing a thumbnail, reading captions, sampling frames, and hearing an entire video.

## Workflow

Open the page through browser_open. Handle normal page loading and authorized playback controls. Call video_list and select a returned player ID. Supply 1–8 distinct finite nonnegative seconds to video_sample, all strictly below the loaded duration. Inspect returned image content, then request a narrower/denser interval when motion detail matters. Use video_captions only for exposed browser text tracks. Close sessions.

## Returned evidence

`owr.video.v1` includes player metadata, requested times, per-frame actual time, capture timestamp, SHA-256 checksum, MIME type, timing method, available overlapping captions, partial failures, warnings, and `restored`.

MCP images are inline `image` content blocks. Structured content omits binary data to avoid duplicating the image payload. A batch with no frames returns an MCP error. Partial success keeps explicit per-timestamp failures.

`audioAnalyzed` is always false in this implementation. A caption track is not speech-recognition output. A `seek-ready` result has met the player's seek/readiness checks; `decoded-frame` additionally observed a video-frame callback. Neither guarantees that a site's custom renderer presents all overlays or that all intervening footage was observed.

## Limits and safety

At most 20 discovered players across 30 frames, 8 timestamps per batch, 40 seconds nominal batch budget, and 6 MiB of returned images. Browser text tracks are bounded to 200 returned cues. Playback position, pause, and mute state are restored best-effort. Player source changes, out-of-range times, detached IDs, hidden players, unloaded/live media, and protected media fail explicitly.

Open shadow roots and embedded HTML frames are supported by discovery. Closed shadow roots, proprietary non-HTML players, canvas-only rendering, live-stream recording, DRM, and audio transcription are not implemented. JavaScript event-loop stalls and browser crashes can still require outer process supervision.

Login and bot-verification requirements are not bypassed. An operator-owned local browser or authorized remote CDP session may provide legitimate access, but that access must be established and tested separately. Never export cookies or signed media URLs to the model.

## Acceptance

The synthetic fixture generates its own four-second moving test pattern and captions with FFmpeg. Tests verify distinct JPEG hashes and timestamps; playback restoration; main, iframe, and shadow-root capture; missing captions; invalid inputs; refreshed/stale IDs; detached media; and a simulated protected-media guard. The latter is a guard test, not a full encrypted-stream test.

MCP tests repeat video operations through both Streamable HTTP and stdio with empty model credentials and an unreachable model base URL. Public video tests remain separate because fixture success does not certify an external platform.
