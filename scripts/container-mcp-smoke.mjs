import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

// Execute inside the built image. No npm install, model credentials, host
// browser, or external network is available to rescue a broken package.
assert.equal(process.env.LLM_API_KEY || '', '');
const endpoint='http://127.0.0.1:8787';
let healthy=false;
for(let i=0;i<60;i++) {
  try {const r=await fetch(endpoint+'/health',{signal:AbortSignal.timeout(1000)});if(r.ok){healthy=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,100));
}
assert.ok(healthy,'packaged API did not become healthy');
assert.equal((await fetch(endpoint+'/v1/tasks')).status,404,'MCP-only image should hide standalone routes');
const client=new Client({name:'owr-packaged-browser-smoke',version:'1.0.0'},{versionNegotiation:{mode:'auto'}});
let session;
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint+'/mcp')));
  const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.notEqual(r.isError,true,JSON.stringify(r.content));return r;};
  const metadata=(await call('runtime_info',{})).structuredContent;
  assert.equal(metadata.modelApiKeyRequired,false);
  const tools=await client.listTools();
  assert.ok(tools.tools.some(t=>t.name==='video_sample'));
  session=(await call('browser_open',{})).structuredContent.session.id;
  assert.equal(typeof session,'string');
  const observed=(await call('browser_observe',{session_id:session})).structuredContent.observation;
  assert.equal(observed.url,'about:blank');
  const screenshot=await call('browser_screenshot',{session_id:session});
  const image=screenshot.content.find(c=>c.type==='image');
  assert.ok(image,'packaged Chromium did not return pixels');
  const bytes=Buffer.from(image.data,'base64');
  assert.equal(image.mimeType,'image/jpeg');assert.ok(bytes.length>1000);assert.equal(bytes[0],255);assert.equal(bytes[1],216);
  assert.equal((await call('video_list',{session_id:session})).structuredContent.status,'no_video');
  await call('browser_close',{session_id:session});session=undefined;
  assert.equal((await call('browser_sessions',{})).structuredContent.sessions.length,0);
  console.log('PACKAGED_BROWSER_PASS',JSON.stringify({transport:'MCP HTTP',modelApiKeyUsed:false,chromiumLaunched:true,jpegBytes:bytes.length,videoToolRegistered:true,publicVideoTested:false}));
} finally {
  if(session)await client.callTool({name:'browser_close',arguments:{session_id:session}}).catch(()=>undefined);
  await client.close().catch(()=>undefined);
}
