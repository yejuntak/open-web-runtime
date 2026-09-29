import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const entry=fileURLToPath(new URL('../apps/api/dist/stdio.js',import.meta.url));
if(!existsSync(entry))throw new Error('Run npm ci && npm run build before generating the client configuration.');
console.log(JSON.stringify({mcpServers:{'open-web-runtime':{command:process.execPath,args:[entry],env:{LLM_API_KEY:'',ALLOW_PRIVATE_NETWORKS:'false'}}}},null,2));
