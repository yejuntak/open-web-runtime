import { chromium } from 'playwright-core';
import { VideoInspector, validateTimestamps } from '../packages/browser/dist/video.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';

/** Match a specific media permalink, never a host-wide prefix or first open tab. */
export function videoPageIdentity(input) {
  const u = new URL(input);
  if (u.username || u.password) throw new Error('Credentials in URLs are not allowed.');
  if (u.href === 'about:blank#owr-fixture') return u.href; // owned offline acceptance fixture
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Expected an HTTP(S) video URL.');
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtube.com' || host === 'youtu.be') {
    const id = host === 'youtu.be' ? u.pathname.split('/')[1] :
      u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(shorts|embed|live)\/([^/]+)\/?$/.exec(u.pathname)?.[2];
    if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('Expected a specific YouTube video, not a feed or search page.');
    return `youtube:${id}`;
  }
  if (host === 'instagram.com') {
    const match = /^\/(reel|reels|p|tv)\/([\w-]+)\/?$/.exec(u.pathname);
    if (!match) throw new Error('Expected an Instagram reel or post permalink.');
    return `instagram:${match[2]}`;
  }
  if (host === 'x.com' || host === 'twitter.com') {
    const match = /^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/video\/\d+)?\/?$/.exec(u.pathname);
    if (!match) throw new Error('Expected an X/Twitter status permalink.');
    return `x:${match[1]}`;
  }
  throw new Error('This adapter accepts only YouTube, Instagram and X/Twitter video permalinks.');
}

/** CDP is privileged. Never connect this helper to an arbitrary network endpoint. */
export function validateLocalEndpoint(input) {
  const u = new URL(input);
  if (!['http:', 'ws:'].includes(u.protocol) || !['127.0.0.1', '[::1]'].includes(u.hostname) ||
      u.username || u.password || !u.port || u.search || u.hash) {
    throw new Error('Use an explicit loopback CDP endpoint, e.g. http://127.0.0.1:9222. Never expose it publicly.');
  }
  return u.toString();
}

/** Inspects only a page already opened by the operator. It does not navigate,
 * log in, read/export cookies, fetch raw media URLs, or close operator tabs. */
export async function inspectOpenVideo({ cdpEndpoint, url, timestamps = [1, 5, 10], playerLabel, outputDir }) {
  const endpoint = validateLocalEndpoint(cdpEndpoint);
  const identity = videoPageIdentity(url);
  validateTimestamps(timestamps);
  const output = outputDir ? resolve(outputDir) : undefined;
  if (output) await mkdir(output, { recursive: true, mode: 0o700 });
  const report = {
    schemaVersion: 'owr.open-tab-video.v1', identity, status: 'failed',
    modelApiKeyUsed: false, cookiesExported: false, audioAnalyzed: false,
    navigationPerformed: false, requestedTimes: timestamps, frames: []
  };
  let browser, inspector;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
    const matches = browser.contexts().flatMap(c => c.pages()).filter(page => {
      try { return videoPageIdentity(page.url()) === identity; } catch { return false; }
    });
    if (matches.length !== 1) throw new Error(`Expected exactly one already-open matching tab; found ${matches.length}. Open the video yourself or close its duplicate tabs.`);
    const page = matches[0];
    await page.bringToFront();
    report.focusedSelectedTab = true;
    inspector = new VideoInspector(page);
    const catalog = await inspector.list();
    // Do not expose other tabs, signed URLs, account information, or unrelated page text.
    report.catalog = { status: catalog.status, videos: catalog.videos, warnings: catalog.warnings };
    const candidates = catalog.videos.filter(v => v.visible && v.readyState >= 2 && !v.encrypted &&
      !v.live && Number.isFinite(v.duration) && v.duration > 0 && (!playerLabel || v.label === playerLabel));
    if (candidates.length !== 1) throw new Error(`Expected one loaded visible on-demand player; found ${candidates.length}. Complete normal sign-in/consent and start the intended video yourself; no bypass is attempted. Use --player to disambiguate multiple players.`);
    const selected = candidates[0];
    if (timestamps.some(t => t >= selected.duration)) throw new Error(`All timestamps must be below ${selected.duration} seconds.`);
    const evidence = await inspector.sample(selected.id, timestamps);
    for (const [i, frame] of evidence.frames.entries()) {
      const sha = createHash('sha256').update(frame.data).digest('hex');
      if (sha !== frame.sha256) throw new Error('Frame checksum mismatch.');
      const file = `frame-${i + 1}.jpg`;
      if (output) await writeFile(join(output, file), frame.data, { mode: 0o600 });
      const { data, ...metadata } = frame;
      report.frames.push({ ...metadata, ...(output ? { file } : {}) });
    }
    report.failures = evidence.failures;
    report.warnings = evidence.warnings;
    report.playbackRestored = evidence.restored;
    report.status = evidence.frames.length === timestamps.length && !evidence.failures.length && evidence.restored ? 'passed' :
      evidence.frames.length ? 'partial' : 'failed';
    return { report, images: evidence.frames.map(f => ({ data: f.data, mimeType: f.mimeType })) };
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    return { report, images: [] };
  } finally {
    await inspector?.dispose().catch(() => undefined);
    // For a CDP-connected Browser, close() disconnects this client; it must not
    // close the user's existing pages. Acceptance tests assert this explicitly.
    await browser?.close().catch(() => undefined);
    if (output) await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  }
}

async function cli() {
  const { values } = parseArgs({ options: {
    cdp: { type: 'string', default: process.env.OWR_LOCAL_CDP ?? 'http://127.0.0.1:9222' },
    url: { type: 'string' }, times: { type: 'string', default: '1,5,10' },
    player: { type: 'string' }, out: { type: 'string', default: './video-evidence' }
  }});
  if (!values.url) throw new Error('Usage: node scripts/inspect-open-video.mjs --url VIDEO_URL --times 1,5,10');
  const timestamps = values.times.split(',').map(s => { if (!s.trim()) throw new Error('Empty timestamp'); return Number(s); });
  const { report } = await inspectOpenVideo({ cdpEndpoint: values.cdp, url: values.url,
    timestamps, playerLabel: values.player, outputDir: values.out });
  console.log(JSON.stringify({ status: report.status, frames: report.frames.length,
    report: join(resolve(values.out), 'report.json'), error: report.error }));
  if (report.status !== 'passed') process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  cli().catch(error => { console.error(error.message); process.exitCode = 1; });
}
