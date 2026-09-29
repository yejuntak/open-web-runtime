# Security and supported deployment boundary

**Developer preview for one trusted operator in an isolated environment. Not an internet-facing, multi-tenant browser service.**

A browser executes untrusted pages and can send requests or modify external accounts. A no-model-key architecture does not eliminate these risks.

## Existing controls

Typed actions limit what the planner requests. Consequential control labels require confirmation; direct Browser/MCP keyboard and implicit-submit actions now have a confirmation check as well. Sensitive typed/select action payloads are reduced in stored traces. Video capture rejects protected-media state, stale IDs, invalid times, hidden/unloaded players, and source changes. Session operations are serialized and active operations are not expired by the idle sweeper.

These are application controls, not complete authorization or security boundaries. A caller-provided confirmed flag is a declaration, not cryptographic proof of a human approval. Labels are heuristic. Forms may autosave. Page text and captions are untrusted and cannot authorize actions.

## Known gaps: do not overclaim

Navigation policy performs URL/host checks. It does not yet enforce a complete DNS/redirect/subresource/WebSocket/rebinding egress policy. Do not describe it as SSRF-proof. The browser must run behind externally enforced outbound restrictions that deny private networks, link-local metadata, and operator control-plane services.

MCP_ONLY restricts route exposure; it is not authentication. OWR_API_TOKEN is a shared bearer guard, not tenant isolation or a complete OAuth implementation. Public MCP access needs an appropriate authenticated MCP deployment plus independent security review. No public endpoint should be enabled with browser write access merely because CI passed.

Tasks, session state, artifacts, and traces are in memory. Per-task limits do not establish a global memory bound. A process supervisor and resource limits are required. Worker recovery, durable state, comprehensive request cancellation, and multi-user identity isolation are incomplete.

Screenshots, video frames, captions, page text, goals, final results, error text, and URL paths can contain private information even when action strings are redacted. Do not publish these outputs without reviewing them. The sample acceptance fixtures contain only project-owned test data. No cookies, private profiles, or signed media URLs should be exported to a model or CI logs.

The remote CDP adapter is only for a dedicated, operator-authorized browser. It is not a tenant-isolation boundary and must not attach indiscriminately to a personal default profile. Authentication, CAPTCHA, DRM and paywall restrictions must not be bypassed.

## Reporting

Report sensitive vulnerabilities privately to the repository owner. Public issues are suitable for the already-documented readiness gaps, not for exposing private credentials or live exploitation details.
