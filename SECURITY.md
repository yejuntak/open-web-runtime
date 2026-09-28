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
