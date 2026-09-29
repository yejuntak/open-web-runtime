import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Project-owned synthetic media; no third-party video is downloaded for CI.
export function makeVideoFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'owr-video-'));
  try {
    const file = join(dir, 'fixture.webm');
    execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i',
      'testsrc2=size=320x180:rate=10:duration=4', '-c:v','libvpx','-b:v','150k','-an','-y',file], { timeout: 20000 });
    return readFileSync(file);
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
export function videoFixtureHtml(bytes) {
  const src = `data:video/webm;base64,${bytes.toString('base64')}`;
  return `<!doctype html><title>OWR video evidence fixture</title>
  <style>body{margin:12px;font:16px system-ui}video{width:320px;height:180px}</style>
  <h1>OWR owned video fixture</h1>
  <video id="main" preload="auto" src="${src}" aria-label="Primary test video"></video>
  <div id="shadow"></div>
  <iframe title="Embedded video" width="360" height="230"></iframe>
  <script>
  const v = document.getElementById('main');
  const t = v.addTextTrack('captions', 'Test captions', 'en');
  t.addCue(new VTTCue(0, 2, 'First half: test pattern moving.'));
  t.addCue(new VTTCue(2, 4, 'Second half: test pattern moving.'));
  t.mode = 'hidden';
  document.getElementById('shadow').attachShadow({mode:'open'}).innerHTML = '<video aria-label="Shadow video" preload="auto" src="${src}" style="width:160px;height:90px"></video>';
  document.querySelector('iframe').srcdoc = '<video aria-label="Embedded video" preload="auto" src="${src}" style="width:320px;height:180px"></video>';
  </script>`;
}
