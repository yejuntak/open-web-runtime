# Third-party software

The initial runtime is independently written.

Runtime dependency:
- Playwright Core — Apache-2.0 — browser/CDP transport.

Development dependencies include TypeScript and tsx.

No TinyFish source code is vendored in v0.1.


Optional integration:
- SearXNG — AGPL-3.0 — may be connected as an independently operated external search service through `SEARXNG_BASE_URL`. SearXNG source code is not copied, linked, or bundled into Open Web Runtime.


MCP / plugin integration:
- @modelcontextprotocol/server — MIT — official Model Context Protocol TypeScript server SDK.
- @modelcontextprotocol/node — MIT — official Node.js HTTP adapter for MCP.
- @modelcontextprotocol/client — MIT — development/test client used by the MCP smoke test.
- zod — MIT — input schema validation for MCP tools.
