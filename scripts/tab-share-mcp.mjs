import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { videoPageIdentity } from './inspect-open-video.mjs';

const host = '127.0.0.1';
const port = Number(process.env.OWR_TAB_BRIDGE_PORT || 8790);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('OWR_TAB_BRIDGE_PORT must be 1024-65535.');
const token = process.env.OWR_TAB_PAIR_TOKEN || randomBytes(24).toString('hex');
const pending = new Map();
const queue = [];
let extension;
let socket;

function acceptKey(key) {
  return createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}
function encodeFrame(text) {
  const data = Buffer.from(text);
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x81, data.length]);
  } else if (data.length <= 0xffff) {
    header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}
function encodeControl(opcode, payload = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
}
function parseFrames(state, onMessage, onClose) {
  while (state.buffer.length >= 2) {
    const b0 = state.buffer[0], b1 = state.buffer[1];
    const fin = Boolean(b0 & 0x80), opcode = b0 & 0x0f, masked = Boolean(b1 & 0x80);
    let length = b1 & 0x7f, offset = 2;
    if (length === 126) {
      if (state.buffer.length < 4) return;
      length = state.buffer.readUInt16BE(2); offset = 4;
    } else if (length === 127) {
      if (state.buffer.length < 10) return;
      const big = state.buffer.readBigUInt64BE(2);
      if (big > BigInt(64 * 1024 * 1024)) throw new Error('Bridge message exceeds 64 MB.');
      length = Number(big); offset = 10;
    }
    if (!masked) throw new Error('Client WebSocket frames must be masked.');
    if (state.buffer.length < offset + 4 + length) return;
    const mask = state.buffer.subarray(offset, offset + 4); offset += 4;
    const payload = Buffer.from(state.buffer.subarray(offset, offset + length));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    state.buffer = state.buffer.subarray(offset + length);
    if (opcode === 0x8) return onClose();
    if (opcode === 0x9) { state.socket.write(encodeControl(0xA, payload)); continue; }
    if (opcode === 0xA) continue;
    if (opcode === 0x1) {
      if (fin) onMessage(payload.toString('utf8'));
      else { state.fragments = [payload]; state.fragmentOpcode = 0x1; }
      continue;
    }
    if (opcode === 0x0 && state.fragments) {
      state.fragments.push(payload);
      if (fin) {
        const message = Buffer.concat(state.fragments).toString('utf8');
        state.fragments = undefined; state.fragmentOpcode = undefined;
        onMessage(message);
      }
    }
  }
}
function send(value) {
  if (!socket || socket.destroyed) throw new Error('No extension is paired.');
  socket.write(encodeFrame(JSON.stringify(value)));
}
function command(command, payload = {}, timeoutMs = 45000) {
  if (!extension || !socket || socket.destroyed) return Promise.reject(new Error('No authorized tab is paired. Open the OWR extension on the intended tab and pair it first.'));
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(command + ' timed out.')); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    send({ type: 'command', id, command, payload });
  });
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, paired: Boolean(extension) }));
    return;
  }
  res.writeHead(404); res.end();
});
http.on('upgrade', (req, rawSocket) => {
  try {
    if (req.url !== '/bridge' || req.headers.upgrade?.toLowerCase() !== 'websocket') return rawSocket.destroy();
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') return rawSocket.destroy();
    rawSocket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + acceptKey(key),
      '\r\n'
    ].join('\r\n'));
    if (socket && !socket.destroyed) socket.destroy();
    socket = rawSocket;
    extension = undefined;
    const state = { buffer: Buffer.alloc(0), socket: rawSocket };
    let authenticated = false;
    rawSocket.on('data', chunk => {
      try {
        state.buffer = Buffer.concat([state.buffer, chunk]);
        parseFrames(state, text => {
          const message = JSON.parse(text);
          if (!authenticated) {
            if (message.type !== 'hello' || message.token !== token) {
              rawSocket.write(encodeControl(0x8)); rawSocket.end(); return;
            }
            videoPageIdentity(message.url);
            authenticated = true;
            extension = {
              tabId: message.tabId, url: message.url, title: message.title || '',
              extensionVersion: message.extensionVersion || '', pairedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
              audioEnabled: false, audioPlaybackForwarded: false
            };
            return;
          }
          extension.lastSeenAt = new Date().toISOString();
          if (message.type === 'ping') return;
          if (message.type === 'capabilities') {
            extension.audioEnabled = message.audioEnabled === true;
            extension.audioPlaybackForwarded = message.audioPlaybackForwarded === true;
            return;
          }
          if (message.type === 'result' && message.id) {
            const waiter = pending.get(message.id);
            if (!waiter) return;
            pending.delete(message.id); clearTimeout(waiter.timer);
            if (message.ok) waiter.resolve(message.result); else waiter.reject(new Error(message.error || 'Extension command failed.'));
          }
        }, () => rawSocket.end());
      } catch {
        rawSocket.destroy();
      }
    });
    rawSocket.on('close', () => {
      if (socket === rawSocket) {
        socket = undefined; extension = undefined;
        for (const [id, waiter] of pending) { clearTimeout(waiter.timer); waiter.reject(new Error('Shared tab disconnected.')); pending.delete(id); }
      }
    });
  } catch {
    rawSocket.destroy();
  }
});
await new Promise((resolve, reject) => {
  http.once('error', reject);
  http.listen(port, host, resolve);
});
console.error(`OWR tab bridge listening on ws://${host}:${port}/bridge`);
console.error(`Pairing token: ${token}`);

function imageToolResult(result) {
  const images = Array.isArray(result.images) ? result.images : [];
  return {
    structuredContent: result.report || {},
    content: [
      { type: 'text', text: JSON.stringify(result.report || {}) },
      ...images.map(image => ({ type: 'image', mimeType: image.mimeType || 'image/jpeg', data: image.data }))
    ]
  };
}

const mcp = new McpServer({ name: 'owr-shared-tab', version: '0.1.0' }, {
  instructions: 'Use only the explicitly user-shared tab. Never request cookies or unrelated tabs. Visual tools capture only the shared tab. Audio capture is optional and must have been explicitly enabled by the user in the extension popup. Audio clips are evidence only; this server does not transcribe them.'
});
mcp.registerTool('shared_tab_status', {
  description: 'Check whether the user has paired exactly one browser tab with the local OWR bridge.',
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
}, async () => ({
  structuredContent: extension ? {
    paired: true, url: extension.url, title: extension.title, pairedAt: extension.pairedAt, lastSeenAt: extension.lastSeenAt,
    audioEnabled: extension.audioEnabled, audioPlaybackForwarded: extension.audioPlaybackForwarded
  } : { paired: false, audioEnabled: false },
  content: [{ type: 'text', text: JSON.stringify(extension ? {
    paired: true, url: extension.url, title: extension.title, audioEnabled: extension.audioEnabled
  } : { paired: false, audioEnabled: false }) }]
}));
mcp.registerTool('video_inspect_shared_tab', {
  description: 'Sample actual JPEG frames at requested timestamps from the one user-authorized shared Instagram/YouTube/X tab when its HTML video is accessible. No login, cookie export or access-control bypass.',
  inputSchema: z.object({
    url: z.string().min(1).max(4096),
    timestamps: z.array(z.number().finite().nonnegative()).min(1).max(8),
    player_label: z.string().min(1).max(240).optional()
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
}, async ({ url, timestamps, player_label }) => {
  if (!extension) return { isError: true, content: [{ type: 'text', text: 'No tab is paired.' }] };
  if (videoPageIdentity(extension.url) !== videoPageIdentity(url)) return { isError: true, content: [{ type: 'text', text: 'The paired tab is not the requested video.' }] };
  try { return imageToolResult(await command('inspect_video', { url, timestamps, playerLabel: player_label })); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
mcp.registerTool('shared_tab_snapshot', {
  description: 'Capture the current visible pixels of the one user-authorized shared tab. Useful when the platform player is not DOM-accessible.',
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true }
}, async () => {
  try { return imageToolResult(await command('snapshot')); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
mcp.registerTool('shared_tab_audio_clip', {
  description: 'Return a short audio clip from the explicitly shared tab, only after the user has enabled optional audio capture in the extension popup. No transcription is performed.',
  inputSchema: z.object({
    duration_seconds: z.number().min(1).max(30).optional()
  }),
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true }
}, async ({ duration_seconds }) => {
  if (!extension?.audioEnabled) return {
    isError: true,
    content: [{ type: 'text', text: 'Audio is not enabled. The user must explicitly enable it from the OWR extension popup first.' }]
  };
  try {
    const result = await command('audio_record', { durationMs: Math.round((duration_seconds || 5) * 1000) }, 40000);
    const audio = result.audio;
    if (!audio?.data || !audio?.mimeType) throw new Error('Audio capture returned no audio block.');
    return {
      structuredContent: result.report || {},
      content: [
        { type: 'text', text: JSON.stringify(result.report || {}) },
        { type: 'audio', data: audio.data, mimeType: audio.mimeType }
      ]
    };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
});
mcp.registerTool('shared_tab_burst', {
  description: 'Capture 2-8 visible frames over time from the shared tab without seeking the DOM player. This visually samples what the user-authorized tab is actually showing, even when the video element is not inspectable.',
  inputSchema: z.object({
    count: z.number().int().min(2).max(8).optional(),
    interval_ms: z.number().int().min(500).max(3000).optional()
  }),
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true }
}, async ({ count, interval_ms }) => {
  try { return imageToolResult(await command('burst', { count: count || 4, intervalMs: interval_ms || 750 })); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
await mcp.connect(new StdioServerTransport());

process.on('SIGINT', async () => { http.close(); process.exit(0); });
process.on('SIGTERM', async () => { http.close(); process.exit(0); });
