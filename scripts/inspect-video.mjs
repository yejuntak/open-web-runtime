import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args=process.argv.slice(2);
function argument(name, fallback){const i=args.indexOf(name);return i<0?fallback:args[i+1];}
const url=argument('--url');
const out=resolve(argument('--out','video-evidence'));
const playerLabel=argument('--player');
const times=String(argument('--times','1,5,10')).split(',').map(Number);
if(!url || !/^https?:$/.test(new URL(url).protocol))throw new Error('Usage: node scripts/inspect-video.mjs --url https://... --times 1,5,10 --out ./video-evidence');
if(times.length<1||times.length>8||times.some(t=>!Number.isFinite(t)||t<0)||new Set(times).size!==times.length)throw new Error('--times needs 1–8 distinct nonnegative seconds');
const client=new Client({name:'owr-video-cli',version:'1.0.0'},{versionNegotiation:{mode:'auto'}});
const entry=fileURLToPath(new URL('../apps/api/dist/stdio.js',import.meta.url));
let session;
const report={schemaVersion:'owr.video.cli.v1',url,status:'failed',modelApiKeyUsed:false,audioAnalyzed:false,requestedTimes:times};
await mkdir(out,{recursive:true});
const timer=setTimeout(()=>{console.error('Video inspection exceeded 120 seconds.');process.exit(1);},120000);timer.unref();
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[entry],env:{...process.env,LLM_API_KEY:'',OPENAI_API_KEY:''},stderr:'inherit'}));
  const call=async(name,arguments_)=>{const r=await client.callTool({name,arguments:arguments_});if(r.isError)throw new Error(r.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')||name+' failed');return r;};
  session=(await call('browser_open',{start_url:url})).structuredContent.session.id;
  await call('browser_wait',{session_id:session,ms:1500});
  report.page=(await call('browser_observe',{session_id:session})).structuredContent.observation;
  report.catalog=(await call('video_list',{session_id:session})).structuredContent;
  const candidates=report.catalog.videos.filter(v=>v.visible&&!v.encrypted&&Number.isFinite(v.duration)&&v.duration>0&&(!playerLabel||v.label===playerLabel));
  if(candidates.length!==1)throw new Error('Expected one visible, loaded, accessible video; got '+candidates.length+'. No login, consent or protection bypass is attempted.');
  const selected=candidates[0];
  if(times.some(t=>t>=selected.duration))throw new Error('--times must all be below duration '+selected.duration+' seconds');
  const result=await call('video_sample',{session_id:session,video_id:selected.id,timestamps:times});
  report.evidence=result.structuredContent;
  const images=result.content.filter(c=>c.type==='image');
  for(const [i,image] of images.entries()){
    if(image.mimeType!=='image/jpeg')throw new Error('Unexpected image MIME type');
    const bytes=Buffer.from(image.data,'base64');if(bytes.length>6*1024*1024)throw new Error('Image budget exceeded');
    await writeFile(join(out,`frame-${i}.jpg`),bytes);
  }
  report.status=report.evidence.failures.length?'partial':'passed';
  report.frames=images.length;
  if(report.status!=='passed')process.exitCode=1;
} catch(e){report.error=e instanceof Error?e.message:String(e);process.exitCode=1;}
finally {
  if(session)await client.callTool({name:'browser_close',arguments:{session_id:session}}).catch(()=>undefined);
  await client.close().catch(()=>undefined);clearTimeout(timer);
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,frames:report.frames??0,report:join(out,'report.json'),error:report.error}));
}
