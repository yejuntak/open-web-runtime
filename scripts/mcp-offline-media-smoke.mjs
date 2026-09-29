import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { BrowserSessionRegistry, WebFetcher } from '@owr/core';
import { PlaywrightBrowserSession } from '@owr/browser';
import { createOpenWebMcpNodeHandler } from '../apps/api/dist/mcp.js';
import { makeVideoFixture, videoFixtureHtml } from './video-fixture.mjs';

// Real runtime/client/browser, but no browser network navigation. This lets
// restricted offline environments validate media without bypassing policy.
const html=videoFixtureHtml(makeVideoFixture());
const provider={async createSession(){
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE_PATH||undefined});
  try {
    const page=await browser.newPage({viewport:{width:900,height:900}});
    await page.setContent(html);
    await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
    return new PlaywrightBrowserSession('owned-offline-fixture',browser,page);
  } catch(e){await browser.close();throw e;}
}};
const sessions=new BrowserSessionRegistry(provider);
const handler=createOpenWebMcpNodeHandler({browserSessions:sessions,webFetcher:new WebFetcher(provider)});
const http=createServer((req,res)=>{void handler(req,res);});
await new Promise(r=>http.listen(0,'127.0.0.1',r));
const client=new Client({name:'owr-offline-acceptance',version:'1.0.0'},{versionNegotiation:{mode:'auto'}});
const out='test-results/video';mkdirSync(out,{recursive:true});
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.address().port}/mcp`)));
  const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.notEqual(r.isError,true,JSON.stringify(r.content));return r;};
  assert.equal((await call('runtime_info',{})).structuredContent.modelApiKeyRequired,false);
  const id=(await call('browser_open',{})).structuredContent.session.id;
  const catalog=(await call('video_list',{session_id:id})).structuredContent;
  const video=catalog.videos.find(v=>v.label==='Primary test video');assert.ok(video);
  const r=await call('video_sample',{session_id:id,video_id:video.id,timestamps:[0.2,1.4,2.8]});
  const images=r.content.filter(c=>c.type==='image');assert.equal(images.length,3);
  assert.equal(r.structuredContent.failures.length,0);assert.equal(r.structuredContent.audioAnalyzed,false);
  for(const [i,image] of images.entries()){
    const data=Buffer.from(image.data,'base64');assert.equal(createHash('sha256').update(data).digest('hex'),r.structuredContent.frames[i].sha256);
    writeFileSync(`${out}/mcp-frame-${i}.jpg`,data);
  }
  const captions=(await call('video_captions',{session_id:id,video_id:video.id,start:0,end:4})).structuredContent;
  assert.equal(captions.cues.length,2);
  await call('browser_close',{session_id:id});
  const report={status:'passed',execution:'actual OWR MCP over HTTP + real Chromium + owned offline fixture',networkNavigation:false,modelApiKeyUsed:false,frames:images.length,evidence:r.structuredContent,captions};
  writeFileSync(`${out}/offline-mcp.json`,JSON.stringify(report,null,2));
  console.log('OFFLINE_MCP_PASS',JSON.stringify({frames:images.length,actualTimes:r.structuredContent.frames.map(f=>f.actualTime),captions:captions.cues.length,modelApiKeyUsed:false}));
} finally {await client.close().catch(()=>undefined);await sessions.closeAll();http.closeAllConnections();await new Promise(r=>http.close(r));}
