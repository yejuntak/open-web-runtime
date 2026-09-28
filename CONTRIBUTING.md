# Contributing

1. Read `CLEAN_ROOM.md`.
2. Keep provider-specific behavior behind adapters.
3. Add tests for new policy, action, observation, or runtime behavior.
4. Do not log API keys, cookies, authorization headers, private debug URLs, or sensitive form values.
5. Record new third-party dependencies in `THIRD_PARTY.md`.
6. Run `npm run typecheck` and `npm test` before opening a pull request.

The project favors small, auditable primitives over opaque browser-agent magic.
