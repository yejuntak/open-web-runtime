import { chromium } from 'playwright-core';
import { VideoInspector } from '../packages/browser/dist/video.js';
import { mkdirSync,writeFileSync } from 'node:fs';
const targets=[
  {name:'youtube',url:process.env.YOUTUBE_TEST_URL||'https://www.youtube.com/watch?v=aqz-KE-bpKQ'},
  {name:'x',url:process.env.X_TEST_URL||'https://x.com/anishfn/status/2102327334485557422/video/1'}
];
const results=[];mkdirSync('test-results/public-video',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE_PATH||undefined});
try {
  for(const target of targets){
    const page=await browser.newPage({viewport:{width:1000,height:800}});const inspector=new VideoInspector(page);
    const result={...target,status:'failed',checkedAt:new Date().toISOString(),frames:0};
    try {
      const response=await page.goto(target.url,{waitUntil:'domcontentloaded',timeout:25000});
      result.httpStatus=response?.status();
      await page.waitForFunction(()=>Boolean(document.body?.innerText.trim()) || Boolean(document.querySelector('video')?.readyState),undefined,{timeout:15000}).catch(()=>undefined);
      await page.waitForTimeout(4000);
      result.title=await page.title();
      result.pageText=(await page.locator('body').innerText({timeout:3000}).catch(()=>'' )).slice(0,1800);
      await page.screenshot({path:`test-results/public-video/${target.name}-page.jpg`,type:'jpeg',quality:50,timeout:4000});
      let catalog=await inspector.list();
      let candidates=catalog.videos.filter(v=>v.visible && !v.encrypted);
      // Normal playback only. No consent dialogs, login, CAPTCHA, or DRM bypass.
      if(candidates.length===1 && !candidates[0].duration && await page.locator('video').count()===1){
        await page.locator('video').evaluate(v=>{v.muted=true;return Promise.race([v.play().catch(()=>undefined),new Promise(r=>setTimeout(r,3000))]);});
        await page.waitForTimeout(3000);catalog=await inspector.list();candidates=catalog.videos.filter(v=>v.visible&&!v.encrypted);
      }
      result.catalog=catalog;
      const video=candidates.length===1?candidates[0]:null;
      if(!video || !video.duration)throw new Error('No unique, loaded, accessible on-demand video player. See page evidence.');
      const times=[...new Set([Math.min(1,video.duration/4),Math.min(5,video.duration/2)])];
      const report=await inspector.sample(video.id,times);
      result.frames=report.frames.length;result.warnings=report.warnings;result.failures=report.failures;
      result.timestamps=report.frames.map(f=>f.actualTime);
      for(const [i,f] of report.frames.entries())writeFileSync(`test-results/public-video/${target.name}-${i}.jpg`,f.data);
      if(report.frames.length!==times.length || report.failures.length)throw new Error('Not all requested frames were captured.');
      result.status='passed';
    }catch(e){result.error=e instanceof Error?e.message:String(e);}
    finally {await inspector.dispose();await page.close();}
    results.push(result);console.log('PUBLIC_VIDEO_RESULT',JSON.stringify(result));
  }
}finally{await browser.close();}
writeFileSync('test-results/public-video/report.json',JSON.stringify({results,note:'Specific URL attempts only. No certification of all YouTube/X media or continuous audio/video understanding.'},null,2));
if(results.some(r=>r.status!=='passed'))process.exitCode=1;
