# Connecting an actual client

OWR has two execution transports. Neither requires an OpenAI API key. Installing/authorizing a tool in a host is distinct from building and testing the server.

## Local stdio host

For a compatible local MCP client, no Railway, public URL, or second LLM is necessary:

```bash
npm ci
npm run build
npx playwright install chromium
node scripts/configure-client.mjs
```

Use the generated absolute-path configuration in the client. The root mcp.json also declares a stdio server using the standard PLUGIN_ROOT working-directory convention for supporting plugin hosts. It requires an already built project and available Chromium. Launch the entry with Node directly; do not put npm log output on an MCP protocol stream.

## ChatGPT remote connection

Use a running, appropriately authenticated HTTPS MCP endpoint or supported secure tunnel. Follow the current client documentation, because availability, menus and workspace policies change:

- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://developers.openai.com/plugins/build/plugins
- https://agent-plugins.org/schemas/1.0.0/mcp.schema.json

Register the connection, inspect/authorize the exposed tools, refresh metadata after updates, and exercise the tools in the actual client. A GitHub URL or ZIP does not itself create an authorized remote tool. No plan-specific read/write entitlement is assumed here.

## Installation acceptance

After connection, call runtime_info. Confirm the video tools appear. Open an authorized test page, inspect a real video using video_list/video_sample, verify that the client receives and can display image blocks, read exposed captions where available, and close the session. Also test a blocked page: the assistant must report the block instead of claiming it watched content.

Only this actual host-level test establishes client usability. A generic MCP client integration test is necessary but not sufficient to claim that a particular user's ChatGPT account is connected.

## Deployment caution

Use [SECURITY.md](../SECURITY.md) as the boundary. Docker publication is not hosting. MCP_ONLY is not auth, and URL checks alone are not complete network isolation. Do not publish an unauthenticated browser executor. Railway remains optional; this project does not presume a connected Railway account.
