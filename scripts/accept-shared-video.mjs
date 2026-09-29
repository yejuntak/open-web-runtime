import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { videoPageIdentity } from './inspect-open-video.mjs';

function parseTimes(value) {
  const times = String(value || '1,5,10').split(',').map(part => {
    if (!part.trim()) throw new Error('Empty timestamp.');
    return Number(part);
  });
  if (times.length < 1 || times.length > 8 || times.some(t => !Number.isFinite(t) || t < 0) || new Set(times).size !== times.length) {
    throw new Error('--times requires 1-8 distinct nonnegative seconds.');
  }
  return times;
}
async function freePort() {
  const server=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();
  const port=typeof address==='object'&&address?address.port:0;
  await new Promise(resolve=>server.close(resolve));
  if(!port) throw new Error('Could not allocate local bridge port.');
  return port;
}
function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
function resultText(result){return (result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');}
function extensionForMime(mime){
  if(String(mime).includes('webm')) return '.webm';
  if(String(mime).includes('wav')) return '.wav';
  if(String(mime).includes('mpeg')||String(mime).includes('mp3')) return '.mp3';
  if(String(mime).includes('ogg')) return '.ogg';
  return '.audio';
}
async function waitForStatus(client, predicate, deadline, description) {
  let last;
  while(Date.now()<deadline){
    last=await client.callTool({name:'shared_tab_status',arguments:{}});
    if(!last.isError&&predicate(last.structuredContent||{})) return last.structuredContent;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error(`Timed out waiting for ${description}. Last status: ${JSON.stringify(last?.structuredContent||{})}`);
}
async function saveImages(result,out,prefix){
  const images=(result.content||[]).filter(c=>c.type==='image');
  const saved=[];
  for(const [index,image] of images.entries()){
    if(!image.data||!String(image.mimeType||'').startsWith('image/')) throw new Error('Invalid image content block.');
    const bytes=Buffer.from(image.data,'base64');
    if(!bytes.length||bytes.length>8*1024*1024) throw new Error('Image is empty or exceeds 8 MB.');
    const file=`${prefix}-${index+1}.jpg`;
    await writeFile(join(out,file),bytes,{mode:0o600});
    saved.push({file,mimeType:image.mimeType,byteLength:bytes.length,sha256:sha256(bytes)});
  }
  return saved;
}

export async function acceptSharedVideo(options){
  const targetIdentity=videoPageIdentity(options.url);
  const times=parseTimes(options.times);
  const out=resolve(options.out||'social-video-acceptance');
  await mkdir(out,{recursive:true,mode:0o700});
  const port=options.bridgePort||await freePort();
  const token=options.pairToken||randomBytes(24).toString('hex');
  const bridgeUrl=`ws://127.0.0.1:${port}/bridge`;
  const extensionDir=resolve(fileURLToPath(new URL('../extension/',import.meta.url)));
  const report={
    schemaVersion:'owr.social-video-acceptance.v1',
    targetUrl:options.url,
    targetIdentity,
    startedAt:new Date().toISOString(),
    modelApiKeyUsed:false,
    cookiesExported:false,
    bridgeUrl,
    visual:{status:'failed',mode:null,frames:[]},
    audio:{requested:Boolean(options.audioSeconds),status:options.audioSeconds?'pending':'not_requested'}
  };
  const client=new Client({name:'owr-social-video-acceptance',version:'1.0.0'},{versionNegotiation:{mode:'auto'}});
  const transport=new StdioClientTransport({
    command:process.execPath,args:['scripts/tab-share-mcp.mjs'],
    env:{...process.env,OWR_TAB_BRIDGE_PORT:String(port),OWR_TAB_PAIR_TOKEN:token,LLM_API_KEY:'',OPENAI_API_KEY:''},
    stderr:'inherit'
  });
  const timeoutMs=Math.max(30_000,Math.min(300_000,Number(options.waitSeconds||120)*1000));
  const deadline=Date.now()+timeoutMs;
  try{
    await client.connect(transport);
    console.error('\nOWR social-video acceptance');
    console.error('1) Load the unpacked extension from:',extensionDir);
    console.error('2) Open and play this exact video:',options.url);
    console.error('3) Open OWR Shared Tab on that tab.');
    console.error('4) Bridge:',bridgeUrl);
    console.error('5) Pairing token:',token);
    console.error('6) Click “Share current tab”.\n');
    const paired=await waitForStatus(client,status=>{
      if(!status.paired||!status.url)return false;
      try{return videoPageIdentity(status.url)===targetIdentity;}catch{return false;}
    },deadline,'the exact requested tab to be shared');
    report.pairedAt=new Date().toISOString();
    report.pairedUrl=paired.url;

    let inspect;
    try{
      inspect=await client.callTool({name:'video_inspect_shared_tab',arguments:{
        url:options.url,timestamps:times,...(options.player?{player_label:options.player}:{})
      }});
    }catch(error){
      inspect={isError:true,content:[{type:'text',text:error.message}]};
    }
    if(!inspect.isError){
      const saved=await saveImages(inspect,out,'timestamp');
      report.visual={
        status:saved.length===times.length?'passed':'partial',
        mode:'timestamp',
        frames:saved,
        evidence:inspect.structuredContent||{}
      };
    }else{
      report.visual.timestampError=resultText(inspect)||'Timestamp inspection failed.';
      const burst=await client.callTool({name:'shared_tab_burst',arguments:{
        count:Math.max(2,Math.min(8,Number(options.burstCount||6))),
        interval_ms:Math.max(500,Math.min(3000,Number(options.burstInterval||750)))
      }});
      if(burst.isError) throw new Error('Timestamp sampling and burst fallback both failed: '+resultText(burst));
      const saved=await saveImages(burst,out,'burst');
      const unique=new Set(saved.map(frame=>frame.sha256)).size;
      report.visual={
        status:saved.length>=2&&unique>=2?'partial':'inconclusive',
        mode:'burst',
        frames:saved,
        uniqueFrameHashes:unique,
        evidence:burst.structuredContent||{},
        timestampError:report.visual.timestampError
      };
    }

    if(options.audioSeconds){
      console.error('\nAudio requested. In the OWR extension popup, click “Enable audio for shared tab (optional)” and approve Chrome’s prompt.\n');
      const audioDeadline=Math.max(deadline,Date.now()+90_000);
      await waitForStatus(client,status=>status.paired&&status.audioEnabled===true,audioDeadline,'optional audio permission/capture');
      const audio=await client.callTool({name:'shared_tab_audio_clip',arguments:{duration_seconds:Number(options.audioSeconds)}});
      if(audio.isError){
        report.audio={requested:true,status:'failed',error:resultText(audio)};
      }else{
        const block=(audio.content||[]).find(c=>c.type==='audio');
        if(!block?.data) throw new Error('Audio tool returned no MCP audio block.');
        const bytes=Buffer.from(block.data,'base64');
        if(!bytes.length||bytes.length>8*1024*1024) throw new Error('Audio is empty or exceeds 8 MB.');
        const file='audio'+extensionForMime(block.mimeType);
        await writeFile(join(out,file),bytes,{mode:0o600});
        report.audio={
          requested:true,status:'passed',file,mimeType:block.mimeType,byteLength:bytes.length,sha256:sha256(bytes),
          evidence:audio.structuredContent||{},transcriptionPerformed:false
        };
      }
    }

    report.completedAt=new Date().toISOString();
    const visualGood=['passed','partial'].includes(report.visual.status);
    const audioGood=!options.audioSeconds||report.audio.status==='passed';
    report.status=visualGood&&audioGood?(report.visual.status==='passed'&&audioGood?'passed':'partial'):'failed';
    await writeFile(join(out,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
    return report;
  }catch(error){
    report.status='failed';
    report.error=error instanceof Error?error.message:String(error);
    report.completedAt=new Date().toISOString();
    await writeFile(join(out,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
    return report;
  }finally{
    await client.close().catch(()=>undefined);
  }
}

async function cli(){
  const {values}=parseArgs({options:{
    url:{type:'string'},times:{type:'string',default:'1,5,10'},out:{type:'string',default:'social-video-acceptance'},
    player:{type:'string'},'audio-seconds':{type:'string'},'wait-seconds':{type:'string',default:'120'},
    'burst-count':{type:'string',default:'6'},'burst-interval':{type:'string',default:'750'},
    'bridge-port':{type:'string'},'pair-token':{type:'string'}
  }});
  if(!values.url)throw new Error('Usage: node scripts/accept-shared-video.mjs --url VIDEO_URL [--times 1,5,10] [--audio-seconds 8]');
  const audioSeconds=values['audio-seconds']===undefined?0:Number(values['audio-seconds']);
  if(audioSeconds&&(!Number.isFinite(audioSeconds)||audioSeconds<1||audioSeconds>30))throw new Error('--audio-seconds must be 1-30.');
  const report=await acceptSharedVideo({
    url:values.url,times:values.times,out:values.out,player:values.player,audioSeconds,
    waitSeconds:Number(values['wait-seconds']),burstCount:Number(values['burst-count']),burstInterval:Number(values['burst-interval']),
    bridgePort:values['bridge-port']?Number(values['bridge-port']):undefined,pairToken:values['pair-token']
  });
  console.log(JSON.stringify({status:report.status,visual:report.visual.status,audio:report.audio.status,report:join(resolve(values.out),'report.json'),error:report.error}));
  if(report.status==='failed')process.exitCode=1;
}
if(process.argv[1]&&fileURLToPath(new URL(import.meta.url))===resolve(process.argv[1]))cli().catch(error=>{console.error(error.message);process.exitCode=1;});
