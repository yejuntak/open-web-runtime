import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const port=8797;
const token='OWR_ACCEPTANCE_FIXED_TEST_TOKEN';
const out=await mkdtemp(join(tmpdir(),'owr-acceptance-'));
const child=spawn(process.execPath,[
  'scripts/accept-shared-video.mjs',
  '--url','https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  '--times','0.2,1.4',
  '--audio-seconds','1',
  '--bridge-port',String(port),
  '--pair-token',token,
  '--wait-seconds','20',
  '--out',out
],{stdio:['ignore','pipe','pipe'],env:{...process.env,LLM_API_KEY:'',OPENAI_API_KEY:''}});
let stdout='',stderr='';
child.stdout.on('data',b=>stdout+=String(b));
child.stderr.on('data',b=>stderr+=String(b));

let socket;
for(let attempt=0;attempt<60;attempt++){
  try{
    socket=new WebSocket(`ws://127.0.0.1:${port}/bridge`);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('connect timeout')),300);
      socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('connect error'));},{once:true});
    });
    break;
  }catch{
    try{socket?.close();}catch{}
    socket=undefined;
    await new Promise(r=>setTimeout(r,100));
  }
}
assert.ok(socket,'Could not connect fake extension to acceptance bridge.');
socket.send(JSON.stringify({type:'hello',token,tabId:9,url:'https://youtu.be/aqz-KE-bpKQ?t=1',title:'Acceptance video',extensionVersion:'0.2.0'}));
socket.send(JSON.stringify({type:'capabilities',audioEnabled:true,audioPlaybackForwarded:true}));
const jpegA=Buffer.from([0xff,0xd8,0xff,0xdb,1,2,3,0xff,0xd9]).toString('base64');
const jpegB=Buffer.from([0xff,0xd8,0xff,0xdb,4,5,6,0xff,0xd9]).toString('base64');
socket.addEventListener('message',event=>{
  const message=JSON.parse(String(event.data));
  if(message.type!=='command')return;
  if(message.command==='inspect_video'){
    socket.send(JSON.stringify({type:'result',id:message.id,ok:true,result:{
      report:{status:'passed',playbackRestored:true,samples:[{requestedTime:.2,actualTime:.2},{requestedTime:1.4,actualTime:1.4}]},
      images:[{mimeType:'image/jpeg',data:jpegA},{mimeType:'image/jpeg',data:jpegB}]
    }}));
  }else if(message.command==='audio_record'){
    socket.send(JSON.stringify({type:'result',id:message.id,ok:true,result:{
      report:{durationMs:1000,mimeType:'audio/webm;codecs=opus',transcriptionPerformed:false},
      audio:{mimeType:'audio/webm;codecs=opus',data:Buffer.from('test-audio').toString('base64')}
    }}));
  }else if(message.command==='burst'){
    socket.send(JSON.stringify({type:'result',id:message.id,ok:true,result:{
      report:{captureMode:'visible-tab-burst'},images:[{mimeType:'image/jpeg',data:jpegA},{mimeType:'image/jpeg',data:jpegB}]
    }}));
  }
});
const exitCode=await new Promise(resolve=>child.on('exit',resolve));
try{
  assert.equal(exitCode,0,'Acceptance CLI failed:\n'+stderr+'\n'+stdout);
  const report=JSON.parse(await readFile(join(out,'report.json'),'utf8'));
  assert.equal(report.status,'passed');
  assert.equal(report.visual.status,'passed');
  assert.equal(report.visual.frames.length,2);
  assert.equal(report.audio.status,'passed');
  assert.equal(report.audio.transcriptionPerformed,false);
  assert.equal(JSON.stringify(report).includes(token),false);
  assert.match(stdout,/"status":"passed"/);
  console.log('SOCIAL_VIDEO_ACCEPTANCE_CLI_PASS',JSON.stringify({visualFrames:2,audio:true,modelKeys:false}));
}finally{
  try{socket?.close();}catch{}
  if(child.exitCode===null)child.kill('SIGKILL');
  await rm(out,{recursive:true,force:true});
}
