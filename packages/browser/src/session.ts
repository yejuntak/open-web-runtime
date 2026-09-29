import type { Browser, CDPSession, Page } from "playwright-core";
import type { AgentAction, BrowserFrame, BrowserSession, PageObservation, SemanticNode } from "@owr/core";
import { captureSemanticPageGraph } from "./semantic.js";
import { VideoInspector } from "./video.js";
export class PlaywrightBrowserSession implements BrowserSession {
  private cdp?: CDPSession;
  private lastObservation?: PageObservation;
  readonly video: VideoInspector;
  constructor(readonly backend: string, private browser: Browser, private page: Page, readonly debugUrl?: string) { this.video=new VideoInspector(page); }
  private async protocol(): Promise<CDPSession> { if (!this.cdp) this.cdp=await this.page.context().newCDPSession(this.page); return this.cdp; }
  async observe(): Promise<PageObservation> { this.lastObservation=await captureSemanticPageGraph(this.page,await this.protocol()); return this.lastObservation; }
  async screenshot(): Promise<BrowserFrame> {
    const data=await this.page.screenshot({type:"jpeg",quality:72,fullPage:false,animations:"allow",caret:"hide",timeout:5000});
    return {data:new Uint8Array(data),mimeType:"image/jpeg",capturedAt:new Date().toISOString(),url:this.page.url()};
  }
  async subscribeFrames(listener:(frame:BrowserFrame)=>void):Promise<()=>Promise<void>> {
    const cdp=await this.protocol(); let active=true;
    const handler=(event:{data:string;sessionId:number})=>{
      try { if (active) listener({data:new Uint8Array(Buffer.from(event.data,"base64")),mimeType:"image/jpeg",capturedAt:new Date().toISOString(),url:this.page.url()}); }
      finally { void cdp.send("Page.screencastFrameAck",{sessionId:event.sessionId}).catch(()=>undefined); }
    };
    cdp.on("Page.screencastFrame",handler);
    try { await cdp.send("Page.startScreencast",{format:"jpeg",quality:58,maxWidth:1600,maxHeight:900,everyNthFrame:2}); }
    catch(e) { cdp.off("Page.screencastFrame",handler); throw e; }
    return async()=>{active=false;cdp.off("Page.screencastFrame",handler);await cdp.send("Page.stopScreencast").catch(()=>undefined);};
  }
  async extractDocument() {
    const [title,text,metadata,rawLinks]=await Promise.all([
      this.page.title(),this.page.locator("body").innerText({timeout:5000}).catch(()=>""),
      this.page.locator("head").evaluate(head=>({description:head.querySelector('meta[name="description"]')?.getAttribute("content"),canonicalHref:head.querySelector('link[rel="canonical"]')?.getAttribute("href")})).catch(()=>({description:null,canonicalHref:null})),
      this.page.locator("a[href]").evaluateAll(elements=>elements.slice(0,500).map(e=>({text:(e.textContent??"").replace(/\s+/g," ").trim().slice(0,300),href:e.getAttribute("href")??""}))).catch(()=>[])
    ]);
    const baseUrl=this.page.url();
    const links=rawLinks.flatMap(link=>{try {const u=new URL(link.href,baseUrl);return link.href && ["http:","https:"].includes(u.protocol)?[{text:link.text,href:u.toString()}]:[];}catch{return [];}});
    let canonicalUrl:string|undefined;try{if(metadata.canonicalHref)canonicalUrl=new URL(metadata.canonicalHref,baseUrl).toString();}catch{}
    return {url:baseUrl,title,text:text.replace(/\n{3,}/g,"\n\n").trim(),links,fetchedAt:new Date().toISOString(),...(metadata.description?{description:metadata.description}:{}),...(canonicalUrl?{canonicalUrl}:{})};
  }
  private node(id:string):SemanticNode {
    const n=this.lastObservation?.nodes.find(n=>n.id===id);
    if(!n)throw new Error(`Semantic node ${id} is not present in the latest observation`);
    if(!n.visible)throw new Error(`Semantic node ${id} is not visible`);
    if(n.disabled)throw new Error(`Semantic node ${id} is disabled`);
    return n;
  }
  private async point(node:SemanticNode):Promise<{x:number;y:number}> {
    const match=/^b(\d+)$/.exec(node.id); if(!match)throw new Error("Invalid backend node ID");
    const cdp=await this.protocol();const backendNodeId=Number(match[1]);
    await cdp.send("DOM.scrollIntoViewIfNeeded",{backendNodeId});
    const result=await cdp.send("DOM.getContentQuads",{backendNodeId});
    const q=result.quads.find(q=>q.length===8);
    if(!q)throw new Error("Target has no current visible click quad");
    return {x:(q[0]!+q[2]!+q[4]!+q[6]!)/4,y:(q[1]!+q[3]!+q[5]!+q[7]!)/4};
  }
  async execute(action:AgentAction):Promise<void> {
    switch(action.type){
      case "navigate":await this.page.goto(action.url,{waitUntil:"domcontentloaded",timeout:45000});this.lastObservation=undefined;return;
      case "click":{const n=this.node(action.nodeId);if(!n.actions.includes("click"))throw new Error(`Node ${n.id} does not advertise click`);const p=await this.point(n);await this.page.mouse.click(p.x,p.y);this.lastObservation=undefined;return;}
      case "type":{const n=this.node(action.nodeId);if(!n.actions.includes("type"))throw new Error(`Node ${n.id} does not advertise text input`);const p=await this.point(n);await this.page.mouse.click(p.x,p.y);await this.page.keyboard.press(process.platform==="darwin"?"Meta+A":"Control+A");await this.page.keyboard.insertText(action.text);if(action.submit)await this.page.keyboard.press("Enter");this.lastObservation=undefined;return;}
      case "select":{const n=this.node(action.nodeId);if(!n.actions.includes("select")||!n.name)throw new Error("Cannot resolve select control");const l=this.page.getByRole("combobox",{name:n.name,exact:true});if(await l.count()!==1)throw new Error(`Could not uniquely resolve select node ${n.id}`);await l.selectOption(action.value);this.lastObservation=undefined;return;}
      case "press":await this.page.keyboard.press(action.key);this.lastObservation=undefined;return;
      case "scroll":await this.page.mouse.wheel(0,action.direction==="down"?action.amount:-action.amount);this.lastObservation=undefined;return;
      case "wait":await this.page.waitForTimeout(action.ms);return;
      case "complete":return;
    }
  }
  async close():Promise<void>{await this.video.dispose();await this.cdp?.detach().catch(()=>undefined);await this.browser.close().catch(()=>undefined);}
}
