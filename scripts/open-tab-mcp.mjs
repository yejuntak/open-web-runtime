import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { inspectOpenVideo, validateLocalEndpoint } from './inspect-open-video.mjs';

const endpoint = validateLocalEndpoint(process.env.OWR_LOCAL_CDP ?? 'http://127.0.0.1:9222');
const server = new McpServer({ name: 'owr-authorized-open-video', version: '0.1.0' }, {
  instructions: 'Inspect only the video permalink the user explicitly asks to analyze, in their already-open authorized browser tab. Never enumerate unrelated tabs or request cookies. This tool does not navigate, sign in or bypass access restrictions. Returned images are samples, not continuous viewing; audio is not analyzed. Report failed or partial evidence honestly.'
});
// Serialize sampling so two requests cannot seek the same player concurrently.
let tail = Promise.resolve();
server.registerTool('video_inspect_open_tab', {
  description: 'Read actual timestamped JPEG video samples and exposed captions from exactly one already-open matching tab in the operator-authorized local browser. May seek/pause then restore playback. Requires the video to be playing normally; does not log in, navigate, download raw media or access cookies.',
  inputSchema: z.object({ url: z.string().min(1).max(4096),
    timestamps: z.array(z.number().finite().nonnegative()).min(1).max(8),
    player_label: z.string().min(1).max(240).optional() }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
}, async ({ url, timestamps, player_label }) => {
  const operation = tail.then(async () => {
    try {
      const { report, images } = await inspectOpenVideo({ cdpEndpoint: endpoint, url, timestamps, playerLabel: player_label });
      return { ...(report.status === 'failed' ? { isError: true } : {}),
        structuredContent: report, content: [
          { type: 'text', text: JSON.stringify(report) },
          ...images.map(image => ({ type: 'image', mimeType: image.mimeType, data: Buffer.from(image.data).toString('base64') }))
        ] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  tail = operation.then(() => undefined, () => undefined);
  return operation;
});
await server.connect(new StdioServerTransport());
