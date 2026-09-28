# Architecture

Open Web Runtime separates planning, policy, browser execution and observation.

```text
natural-language goal
        |
        v
     Planner
        |
        v
  typed AgentAction
        |
        v
    Policy Gate
        |
        v
  BrowserSession
        |
        +---- user-input execution
        |
        +---- CDP DOMSnapshot
        +---- CDP AX tree
        +---- layout bounds
                  |
                  v
          Semantic Page Graph
                  |
                  v
            trace / SSE
```

The planner does not receive a JavaScript execution primitive. Browser actions are restricted to the typed action contract.

Semantic node IDs use Chromium backend DOM identities, such as `b44`. Observation does not add private attributes to the target page.

The initial implementation keeps task state in memory. Durable stores, distributed workers and cross-navigation semantic matching are later milestones.
