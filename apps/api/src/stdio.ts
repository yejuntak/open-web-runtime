import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { browserProviderFromEnv } from "@owr/browser";
import { BrowserSessionRegistry, WebFetcher } from "@owr/core";
import { searchProviderFromEnv } from "@owr/search";
import { createOpenWebMcpServer } from "./mcp.js";

// A local MCP client owns this process. No HTTP port, cloud host or model key.
const provider=browserProviderFromEnv();
const options={allowPrivateNetworks:process.env.ALLOW_PRIVATE_NETWORKS==="true"};
const sessions=new BrowserSessionRegistry(provider,{...options,maxSessions:4,ttlMs:300000});
const server=createOpenWebMcpServer({browserSessions:sessions,webFetcher:new WebFetcher(provider,options),searchProvider:searchProviderFromEnv()});
const timer=setInterval(()=>{void sessions.sweepExpired();},30000);timer.unref();
let stopping=false;
async function stop(){if(stopping)return;stopping=true;clearInterval(timer);await sessions.closeAll();await server.close();}
process.on("SIGINT",()=>{void stop().finally(()=>process.exit(0));});
process.on("SIGTERM",()=>{void stop().finally(()=>process.exit(0));});
process.stdin.on("end",()=>{void stop().finally(()=>process.exit(0));});
await server.connect(new StdioServerTransport());
