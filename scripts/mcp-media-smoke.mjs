import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync,writeFileSync } from 'node:fs';
import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { makeVideoFixture,videoFixtureHtml } from './video-fixture.mjs';

const listen=s=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',()=>resolve(s.address().port));});
const close=s=>new Promise(resolve=>{s.closeAllConnections?.();s.close(resolve);});
const fixtureHtml=videoFixtureHtml(makeVideoFixture());
const fixture=createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(fixtureHtml);});
const port=await listen(fixture);
const url=`http://127.0.0.1:${port}/`;
const results=[];
const timeout=setTimeout(()=>{console.error('MCP media acceptance timed out');process.exit(1);},120000);timeout.unref();
try {
  for(const mode of ['http','stdio']) {
    let child,client;const logs=[];
    const env={...process.env,LLM_API_KEY:'',LLM_BASE_URL:'http://127.0.0.1:9',OPENAI_API_KEY:'',OWR_API_TOKEN:'',REMOTE_CDP_URL:'',MCP_ONLY:'true',ALLOW_PRIVATE_NETWORKS:'true',LIVE_FRAMES:'false',CAPTURE_SCREENSHOTS:'false',HOST:'127.0.0.1'};
    try {
      client=new Client({name:'owr-media-acceptance',version:'1.0.0'},{versionNegotiation:{mode:'auto'}});
      if(mode==='stdio') {
        await client.connect(new StdioClientTransport({command:process.execPath,args:['apps/api/dist/stdio.js'],env,stderr:'pipe'}));
      } else {
        const probe=createServer();const apiPort=await listen(probe);await close(probe);
        env.PORT=String(apiPort);
        child=spawn(process.execPath,['apps/api/dist/server.js'],{env,stdio:['ignore','pipe','pipe']});
        child.stdout.on('data',b=>logs.push(String(b)));child.stderr.on('data',b=>logs.push(String(b)));
        let healthy=false;
        for(let i=0;i<100;i++) {try{const r=await fetch(`http://127.0.0.1:${apiPort}/health`);if(r.ok){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
        assert.ok(healthy,'server failed: '+logs.join(''));
        assert.equal((await fetch(`http://127.0.0.1:${apiPort}/v1/tasks`)).status,404);
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${apiPort}/mcp`)));
      }
      const tools=await client.listTools();
      for(const name of ['video_list','video_sample','video_captions','runtime_info'])assert.ok(tools.tools.some(t=>t.name===name));
      const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.notEqual(r.isError,true,JSON.stringify(r.content));return r;};
      assert.equal((await call('runtime_info',{})).structuredContent.modelApiKeyRequired,false);
      const session=(await call('browser_open',{start_url:url})).structuredContent.session.id;
      await call('browser_wait',{session_id:session,ms:300});
      const catalog=(await call('video_list',{session_id:session})).structuredContent;
      assert.equal(catalog.videos.length,3);
      const main=catalog.videos.find(v=>v.label==='Primary test video');
      const sample=await call('video_sample',{session_id:session,video_id:main.id,timestamps:[0.2,1.4,2.8]});
      assert.equal(sample.content.filter(c=>c.type==='image').length,3);
      assert.equal(sample.structuredContent.frames.length,3);
      assert.equal(sample.structuredContent.audioAnalyzed,false);
      assert.equal(sample.structuredContent.failures.length,0);
      assert.ok(sample.structuredContent.frames.every(f=>!('data' in f)),'binary must not duplicate in structuredContent');
      const captions=(await call('video_captions',{session_id:session,video_id:main.id,start:0,end:4})).structuredContent;
      assert.equal(captions.status,'available');assert.equal(captions.cues.length,2);
      const invalid=await client.callTool({name:'video_sample',arguments:{session_id:session,video_id:main.id,timestamps:[999]}});
      assert.equal(invalid.isError,true);
      const pressed=await call('browser_press',{session_id:session,key:'Enter'});
      assert.equal(pressed.structuredContent.result.executed,false,'Enter must not bypass confirmation');
      await call('browser_close',{session_id:session});
      assert.equal((await call('browser_sessions',{})).structuredContent.sessions.length,0);
      results.push({transport:mode,status:'passed',modelKey:false,frames:3,captions:2,implicitSubmitBlocked:true});
      console.log('MCP_MEDIA_PASS',JSON.stringify(results.at(-1)));
    } finally {
      await client?.close().catch(()=>undefined);
      if(child && child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>{child.once('exit',r);setTimeout(()=>{child.kill('SIGKILL');r();},3000).unref();});}
    }
  }
  mkdirSync('test-results/video',{recursive:true});writeFileSync('test-results/video/mcp-transports.json',JSON.stringify({results},null,2));
} finally {clearTimeout(timeout);await close(fixture);}
