import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createHash } from 'node:crypto';
import { videoPageIdentity, validateLocalEndpoint } from './inspect-open-video.mjs';
import { makeVideoFixture, videoFixtureHtml } from './video-fixture.mjs';

const dir = await mkdtemp(join(tmpdir(), 'owr-open-tab-'));
const chromePath = process.env.CHROME_EXECUTABLE_PATH || chromium.executablePath();
const checks = [];
let child, owner, client;
const globalTimeout = setTimeout(() => { console.error('Open-tab acceptance exceeded 90 seconds'); child?.kill('SIGKILL'); process.exit(1); }, 90000);
globalTimeout.unref();
try {
  assert.equal(videoPageIdentity('https://youtu.be/aqz-KE-bpKQ?t=1'), videoPageIdentity('https://www.youtube.com/watch?v=aqz-KE-bpKQ&list=abc'));
  assert.equal(videoPageIdentity('https://instagram.com/reel/AbCd_123/?igsh=tracking'), videoPageIdentity('https://www.instagram.com/p/AbCd_123/'));
  assert.equal(videoPageIdentity('https://twitter.com/user/status/12345/video/1'), videoPageIdentity('https://x.com/user/status/12345?s=20'));
  assert.notEqual(videoPageIdentity('https://www.youtube.com/watch?v=aqz-KE-bpKQ'), videoPageIdentity('https://www.youtube.com/watch?v=abcdefghijk'));
  for (const url of ['https://instagram.com/direct/inbox','https://x.com/home','https://youtube.com/results?search_query=x','file:///etc/passwd']) assert.throws(() => videoPageIdentity(url));
  for (const url of ['http://example.com:9222','http://127.0.0.1.evil.test:9222','http://u:p@127.0.0.1:9222','http://127.0.0.1:9222?token=x']) assert.throws(() => validateLocalEndpoint(url));
  checks.push('permalink identity and endpoint/input rejection');
  child = spawn(chromePath, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: ['ignore','ignore','pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let logs = '';
    const timeout = setTimeout(() => reject(new Error('Chromium did not expose local CDP: ' + logs.slice(-500))), 15000);
    child.once('error', e => { clearTimeout(timeout); reject(e); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('Chromium exited: ' + code)); });
    child.stderr.on('data', b => {
      logs += String(b); const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/.exec(logs);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  owner = await chromium.connectOverCDP(endpoint);
  const context = owner.contexts()[0];
  const page = context.pages()[0];
  await page.goto('about:blank#owr-fixture');
  await page.setContent(videoFixtureHtml(makeVideoFixture()));
  await page.waitForFunction(() => document.querySelector('#main').readyState >= 2);
  await page.locator('#main').evaluate(v => { v.pause(); v.muted = true; v.currentTime = .7; });
  await page.waitForFunction(() => !document.querySelector('#main').seeking);
  const other = await context.newPage();
  await other.setContent('<title>Unrelated private tab</title><p>Do not inspect me</p>');
  await context.addCookies([{ name:'owr-fixture-cookie', value:'SYNTHETIC_PRIVATE_VALUE', domain:'example.com', path:'/', secure:true }]);
  client = new Client({name:'open-tab-acceptance',version:'1.0.0'},{versionNegotiation:{mode:'auto'}});
  await client.connect(new StdioClientTransport({command:process.execPath,args:['scripts/open-tab-mcp.mjs'],
    env:{...process.env,OWR_LOCAL_CDP:endpoint,LLM_API_KEY:'',OPENAI_API_KEY:''},stderr:'pipe'}));
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(t => t.name), ['video_inspect_open_tab']);
  const result = await client.callTool({name:'video_inspect_open_tab',arguments:{url:'about:blank#owr-fixture',timestamps:[.2,1.4,2.8],player_label:'Primary test video'}});
  assert.notEqual(result.isError,true,JSON.stringify(result));
  assert.equal(result.structuredContent.status,'passed', JSON.stringify(result.structuredContent));
  assert.equal(result.content.filter(c=>c.type==='image').length,3);
  assert.equal(result.structuredContent.playbackRestored,true);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_VALUE'),false);
  const state = await page.locator('#main').evaluate(v => ({time:v.currentTime,muted:v.muted,paused:v.paused}));
  assert.ok(Math.abs(state.time-.7)<.15); assert.equal(state.paused,true); assert.equal(state.muted,true);
  assert.equal(page.isClosed(),false); assert.equal(other.isClosed(),false); assert.equal(await other.title(),'Unrelated private tab');
  assert.equal((await context.cookies('https://example.com'))[0].value,'SYNTHETIC_PRIVATE_VALUE');
  checks.push('real stdio MCP; three timestamped JPEGs; existing session survives; playback restored; cookie stays local');
  const duplicate = await context.newPage(); await duplicate.goto('about:blank#owr-fixture');
  const ambiguous = await client.callTool({name:'video_inspect_open_tab',arguments:{url:'about:blank#owr-fixture',timestamps:[.2]}});
  assert.equal(ambiguous.isError,true); assert.match(ambiguous.structuredContent.error,/found 2/); await duplicate.close();
  const missing = await client.callTool({name:'video_inspect_open_tab',arguments:{url:'https://www.youtube.com/watch?v=aqz-KE-bpKQ',timestamps:[1]}});
  assert.equal(missing.isError,true); assert.match(missing.structuredContent.error,/found 0/);
  checks.push('duplicate and missing tabs fail closed without navigation');
  await mkdir('test-results/open-tab',{recursive:true});
  const images=result.content.filter(c=>c.type==='image');
  for(const [i,img] of images.entries()) {
    const bytes=Buffer.from(img.data,'base64');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),result.structuredContent.frames[i].sha256);
    await writeFile(`test-results/open-tab/frame-${i+1}.jpg`,bytes);
  }
  await writeFile('test-results/open-tab/report.json',JSON.stringify({status:'passed',checks,evidence:result.structuredContent,
    boundary:'Owned offline fixture and synthetic cookie. Not a real Instagram, YouTube or X playback success.'},null,2));
  console.log('OPEN_TAB_PASS',JSON.stringify({checks,frames:3,modelKeys:false,externalNetworkUsed:false}));
} finally {
  clearTimeout(globalTimeout);
  await client?.close().catch(()=>{}); await owner?.close().catch(()=>{});
  if(child && child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>{child.once('exit',r);setTimeout(()=>{child.kill('SIGKILL');r();},2000).unref();});}
  await rm(dir,{recursive:true,force:true}).catch(()=>{});
}
