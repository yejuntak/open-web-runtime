# Security

Open Web Runtime executes browser actions and should be treated as a privileged automation component.

Default protections:
- only http/https navigation;
- private and local network targets are blocked by default;
- URL-embedded credentials are rejected;
- consequential controls require human approval by default;
- the planner cannot return arbitrary JavaScript;
- secrets and form values are not intentionally written to task traces.

Do not expose the API directly to the public internet without authentication, tenancy isolation, rate limits, and an outbound network policy.

Report security issues privately to the repository owner rather than opening a public issue.

## Browser images

When enabled, the inspector can expose browser content through two channels:

- live screencast frames: only the newest frame is held in memory and is removed when execution ends;
- screenshot artifacts: bounded per task, but retained in memory for later inspection.

Both can contain credentials, personal information, or other sensitive page content even when structured traces avoid recording form values. Disable them with `LIVE_FRAMES=false` and/or `CAPTURE_SCREENSHOTS=false` for sensitive workloads. Production deployments should replace the in-memory artifact store with an encrypted, access-controlled backend and explicit retention policy.


## Trace redaction

The execution engine uses full action payloads only for the immediate browser operation. Persisted step records and approval/event payloads redact typed text and select values to lengths, and traced navigation removes credentials, query strings, and fragments. Task goals and final results remain user-controlled data and may still contain sensitive information.
