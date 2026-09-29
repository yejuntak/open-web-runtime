import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { makeVideoFixture, videoFixtureHtml } from './video-fixture.mjs';
const moduleUrl = process.env.VIDEO_MODULE_PATH
  ? pathToFileURL(resolve(process.env.VIDEO_MODULE_PATH)).href
  : new URL('../packages/browser/dist/video.js', import.meta.url).href;
const { VideoInspector, validateTimestamps } = await import(moduleUrl);
const outDir = process.env.VIDEO_EVIDENCE_DIR || 'test-results/video';
mkdirSync(outDir, { recursive: true });
const assertions = [];
const pass = name => { assertions.push(name); console.log('PASS:', name); };
const browser = await chromium.launch({headless:true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined});
try {
  const page = await browser.newPage({viewport:{width:900,height:900}});
  await page.setContent(videoFixtureHtml(makeVideoFixture()));
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  const inspector = new VideoInspector(page);
  let catalog = await inspector.list();
  assert.equal(catalog.videos.length, 3);
  pass('discovers videos in main document, open shadow root, and iframe');
  let main = catalog.videos.find(v => v.label === 'Primary test video');
  assert.equal(main.duration, 4);
  pass('reads actual decoded duration and player metadata');
  const report = await inspector.sample(main.id, [0.2, 1.4, 2.8]);
  assert.equal(report.frames.length, 3, JSON.stringify(report.failures));
  assert.equal(report.failures.length, 0);
  assert.equal(report.audioAnalyzed, false);
  assert.equal(new Set(report.frames.map(f => f.sha256)).size, 3);
  for (const [i, frame] of report.frames.entries()) {
    assert.ok(Math.abs(frame.actualTime-frame.requestedTime) < 0.25);
    assert.ok(frame.data.byteLength > 1000);
    writeFileSync(`${outDir}/frame-${i}.jpg`, frame.data);
  }
  pass('three distinct real JPEG frames at verified timestamps');
  assert.equal(report.frames[0].captions[0].text, 'First half: test pattern moving.');
  assert.equal(report.frames[2].captions[0].text, 'Second half: test pattern moving.');
  pass('time-aligned browser-exposed captions');
  assert.equal(report.restored, true);
  assert.equal(await page.locator('#main').evaluate(v => v.paused), true);
  assert.equal(await page.locator('#main').evaluate(v => v.muted), false);
  pass('restores original time, pause, and mute state');
  const embedded = catalog.videos.find(v => v.label === 'Embedded video');
  const embeddedReport = await inspector.sample(embedded.id, [1]);
  assert.equal(embeddedReport.frames.length, 1, JSON.stringify(embeddedReport.failures));
  pass('captures a real frame from embedded player');
  const shadow = catalog.videos.find(v => v.label === 'Shadow video');
  assert.equal((await inspector.sample(shadow.id,[1])).frames.length,1);
  pass('captures a real frame from shadow-root player');
  assert.equal((await inspector.captions(embedded.id)).status, 'not_exposed');
  pass('missing captions reported as unavailable, not invented');
  for (const bad of [[],[-1],[Infinity],[NaN],[0,0],Array.from({length:9},(_,i)=>i)]) {
    assert.throws(() => validateTimestamps(bad));
  }
  await assert.rejects(() => inspector.sample(main.id, [4]), /outside/);
  pass('invalid, duplicate, excessive, and out-of-range timestamps rejected');
  const previousId = main.id;
  catalog = await inspector.list();
  await assert.rejects(() => inspector.sample(previousId,[0]), /missing or replaced/);
  pass('old video IDs rejected after discovery refresh');
  main = catalog.videos.find(v => v.label === 'Primary test video');
  await page.locator('#main').evaluate(v => Object.defineProperty(v,'mediaKeys',{configurable:true,get:()=>({})}));
  await assert.rejects(() => inspector.sample(main.id,[0.2]), /DRM/);
  pass('protected-media guard rejects encrypted player state');
  await page.locator('#main').evaluate(v => { delete v.mediaKeys; v.remove(); });
  await assert.rejects(() => inspector.sample(main.id,[0.2]), /missing or replaced/);
  pass('detached player fails safely');
  await inspector.dispose();
  await page.setContent('<h1>No player</h1>');
  assert.equal((await inspector.list()).status, 'no_video');
  pass('no-video pages return explicit status');
  await inspector.dispose();
  writeFileSync(`${outDir}/report.json`, JSON.stringify({
    status:'passed', assertions, runtime:{node:process.version,chromium:browser.version()},
    report:{...report,frames:report.frames.map(({data,...f})=>({...f,byteLength:data.byteLength}))},
    limitations:['Synthetic owned fixture, not a YouTube/X success claim.','No audio transcription.','Sparse frames, not continuous viewing.']
  },null,2));
  console.log(`VIDEO_ACCEPTANCE: ${assertions.length} checks passed`);
} finally { await browser.close(); }
