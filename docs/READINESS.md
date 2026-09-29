# Readiness: evidence, not a completion badge

## Verdict

This is a developer-preview browser/MCP runtime with real video-frame inspection. It is **not yet a production-complete TinyFish replacement or a verified, installed ChatGPT browser app**. Earlier statements that only deployment remained were too broad.

## Verified at candidate d9c9c5d

- Actual Chromium media tests passed 13 checks locally and in CI.
- HTTP and stdio MCP video calls passed with empty OpenAI/model keys.
- Captured frames are actual JPEG pixels at checked timestamps; the synthetic scene was visually inspected.
- Browser-exposed captions, missing-caption status, safety guards, and playback restoration were tested.
- Evidence: https://github.com/yejuntak/open-web-runtime/actions/runs/36511902885

## Public-site outcomes

The real public probe used these specific URLs from an unauthenticated GitHub runner:

- YouTube: https://www.youtube.com/watch?v=aqz-KE-bpKQ . The page rendered but required sign-in to confirm the browser was not a bot. The player was unloaded; zero video frames were captured.
- X: https://x.com/anishfn/status/2102327334485557422/video/1 . The attempt returned a blank rendered page and no video. The cause was not established; zero video frames were captured.

The probe is intentionally failed, not relabeled as successful support. Page screenshots and report are retained as workflow artifacts: https://github.com/yejuntak/open-web-runtime/actions/runs/36511903074 . These results neither prove universal failure nor certify other videos. Public compatibility requires actual successful playback/frame evidence in the intended environment.

## Release-blocking criteria

| Requirement | Current position | Exit evidence |
|---|---|---|
| No second model API key | Implemented and transport-tested | Preserve no-key HTTP/stdio tests |
| Native use in the user's ChatGPT | Not connected in this conversation | Authorized tool registration followed by actual calls from that client |
| Reliable YouTube and X video access | Not verified; initial public attempts failed | Real intended URLs sampled successfully in the authorized deployment |
| Visual understanding of entire videos | Sparse samples only | Defined temporal coverage, scene tests and gap reporting |
| Audio understanding | No transcription | Local/authorized audio pipeline and accuracy tests; no fabricated captions |
| Public multi-user deployment | Not ready | Auth/OAuth, tenant isolation, resource quotas, network enforcement and independent review |
| Browser security boundary | URL checks are incomplete | DNS/redirect/subresource/rebinding coverage plus external egress isolation |
| Durable operations | In-memory state, limited recovery | Durable stores, restart/cleanup tests and bounded global resource use |

The local stdio entry and portable mcp.json remove the need for Railway in compatible local clients, but do not install or authorize themselves. The source ZIP still requires dependencies, a build, and Chromium. Container publication and MCP initialize tests do not prove video capability or client installation.

## What is deliberately not claimed

No benchmark superiority, guaranteed anti-bot bypass, complete SSRF protection, universal site coverage, deterministic web replay, automatic future-chat access, encrypted persistent profiles, or hearing audio. Text redaction does not remove sensitive content from screenshots, page text, goals, results, or every URL path.
