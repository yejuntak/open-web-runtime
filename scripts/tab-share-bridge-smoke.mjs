import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const port = 8794;
const token = 'TEST_PAIR_TOKEN_OWR';
const client = new Client({ name: 'owr-tab-share-smoke', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
let fake;
const images = ['aGVsbG8=', 'd29ybGQ='];
try {
  const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ['activeTab','scripting'].sort());
  assert.deepEqual(manifest.optional_permissions.sort(), ['offscreen','tabCapture'].sort());
  assert.equal(JSON.stringify(manifest).includes('<all_urls>'), false);
  assert.equal(manifest.permissions.includes('tabCapture'), false);
  assert.equal(manifest.permissions.includes('offscreen'), false);

  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['scripts/tab-share-mcp.mjs'],
    env: { ...process.env, OWR_TAB_BRIDGE_PORT: String(port), OWR_TAB_PAIR_TOKEN: token, LLM_API_KEY: '', OPENAI_API_KEY: '' },
    stderr: 'pipe'
  }));

  fake = new WebSocket(`ws://127.0.0.1:${port}/bridge`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fake extension did not connect')), 5000);
    fake.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    fake.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Fake extension websocket error')); }, { once: true });
  });
  fake.send(JSON.stringify({ type: 'hello', token, tabId: 77, url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Authorized test tab', extensionVersion: '0.2.0' }));
  fake.send(JSON.stringify({ type: 'capabilities', audioEnabled: true, audioPlaybackForwarded: true }));
  fake.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.type !== 'command') return;
    if (message.command === 'inspect_video') {
      fake.send(JSON.stringify({ type: 'result', id: message.id, ok: true, result: {
        report: { status: 'passed', url: message.payload.url, playbackRestored: true, captureMode: 'authorized-active-tab', samples: [{ requestedTime: .2, actualTime: .2 }] },
        images: [{ mimeType: 'image/jpeg', data: images[0] }]
      }}));
    } else if (message.command === 'snapshot') {
      fake.send(JSON.stringify({ type: 'result', id: message.id, ok: true, result: { report: { capturedAt: new Date().toISOString() }, images: [{ mimeType: 'image/jpeg', data: images[1] }] }}));
    } else if (message.command === 'audio_record') {
      fake.send(JSON.stringify({ type: 'result', id: message.id, ok: true, result: {
        report: { durationMs: message.payload.durationMs, byteLength: 5, mimeType: 'audio/webm;codecs=opus', transcriptionPerformed: false },
        audio: { mimeType: 'audio/webm;codecs=opus', data: 'YXVkaW8=' }
      }}));
    } else if (message.command === 'burst') {
      fake.send(JSON.stringify({ type: 'result', id: message.id, ok: true, result: {
        report: { captureMode: 'visible-tab-burst', frames: [{ index: 0 }, { index: 1 }] },
        images: images.map(data => ({ mimeType: 'image/jpeg', data }))
      }}));
    }
  });

  await new Promise(resolve => setTimeout(resolve, 100));
  const status = await client.callTool({ name: 'shared_tab_status', arguments: {} });
  assert.equal(status.structuredContent.paired, true);
  assert.match(status.structuredContent.url, /youtube\.com/);
  assert.equal(status.structuredContent.audioEnabled, true);

  const inspect = await client.callTool({ name: 'video_inspect_shared_tab', arguments: {
    url: 'https://youtu.be/aqz-KE-bpKQ?t=2', timestamps: [.2]
  }});
  assert.notEqual(inspect.isError, true);
  assert.equal(inspect.content.filter(c => c.type === 'image').length, 1);

  const wrong = await client.callTool({ name: 'video_inspect_shared_tab', arguments: {
    url: 'https://www.youtube.com/watch?v=abcdefghijk', timestamps: [.2]
  }});
  assert.equal(wrong.isError, true);

  const audio = await client.callTool({ name: 'shared_tab_audio_clip', arguments: { duration_seconds: 2 }});
  assert.notEqual(audio.isError, true);
  assert.equal(audio.content.filter(c => c.type === 'audio').length, 1);
  assert.equal(audio.content.find(c => c.type === 'audio').mimeType, 'audio/webm;codecs=opus');

  const burst = await client.callTool({ name: 'shared_tab_burst', arguments: { count: 2, interval_ms: 500 }});
  assert.equal(burst.content.filter(c => c.type === 'image').length, 2);

  const snap = await client.callTool({ name: 'shared_tab_snapshot', arguments: {} });
  assert.equal(snap.content.filter(c => c.type === 'image').length, 1);

  console.log('TAB_SHARE_BRIDGE_PASS', JSON.stringify({ tools: 5, modelKeys: false, allUrlsPermission: false, optionalAudio: true }));
} finally {
  try { fake?.close(); } catch {}
  await client.close().catch(() => undefined);
}