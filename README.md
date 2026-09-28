# Open Web Runtime

An open, inspectable web execution runtime for AI agents.

**Status:** v0.1 / experimental

Open Web Runtime turns a natural-language goal into typed browser actions against a semantic page graph. The planner, browser backend, policy layer, storage, and model provider are intentionally replaceable.

> Independent clean-room implementation. Not affiliated with TinyFish. See `CLEAN_ROOM.md` before contributing.

## Architecture

```text
Goal
  |
  v
Planner
  |
  v
Typed AgentAction
  |
  v
Policy Gate
  |
  v
BrowserProvider
  |
  v
Playwright / CDP
  |
  v
Semantic Page Graph
  |
  v
Trace + SSE + Inspector
```

The planner does not receive arbitrary JavaScript or Playwright access. It operates on bounded semantic observations and typed actions such as `click`, `type`, `select`, `scroll`, `wait`, and `complete`.

## v0.1

- provider-neutral agent runtime
- local Chromium and Steel browser adapters
- OpenAI-compatible planner adapter
- semantic page observations
- typed action validation
- SSE event stream
- task traces
- approval gates for consequential controls
- TypeScript SDK and CLI
- Docker support
- tests and GitHub Actions
- clean-room contribution policy

Full documentation lands in this repository in the bootstrap commit.

## License

Apache-2.0.
