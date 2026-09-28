---
name: open-web-browser
description: Use Open Web Runtime when a task needs rendered web fetching, live browser interaction, form filling, dynamic-page navigation, screenshots, or a TinyFish-like browser execution layer.
---

Use Open Web Runtime as the execution layer while the host model remains the planner.

1. If the user only needs the contents of a known URL, call `web_fetch`.
2. If discovery is needed and `web_search` is configured, call `web_search`, then `web_fetch` the most relevant result when needed.
3. For interactive or multi-step sites:
   - call `browser_open` with the starting URL;
   - call `browser_observe`;
   - choose exactly one action using a node ID from the latest observation;
   - call the matching `browser_*` action tool;
   - observe again after state changes.
4. Never invent or reuse a stale node ID after navigation or a substantial page update.
5. Call `browser_screenshot` when layout, visual state, canvas content, or ambiguous controls make semantic observation insufficient.
6. Close the session with `browser_close` when finished.
7. If `browser_click` returns `confirmationRequired`, do not set `confirmed=true` until the user explicitly approves that consequential action.
8. Do not ask for an OpenAI API key. The ChatGPT/Codex host provides the reasoning model; this MCP server only executes web actions.
9. Avoid echoing secrets entered with `browser_type`. Use only the minimum sensitive data needed for the user's requested task.
