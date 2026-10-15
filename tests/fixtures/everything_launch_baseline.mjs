import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {spawn} from 'node:child_process';
const baseline=JSON.parse(fs.readFileSync(new URL('./everything-session-policy.json',import.meta.url),'utf8'));
const root=process.argv[2];
const start=vm.runInNewContext('let everythingStartPromise=null;\n'+baseline.functions.instanceArgs.source+'\n'+baseline.functions.startEverythingBackground.source+'\nstartEverythingBackground',{
 spawn,APP_ROOT:root,findEverythingExecutable:async()=>path.join(root,'missing-app.exe'),appendLog:async()=>{},waitForEverything:()=>new Promise(()=>{}),loadConfig:async()=>({}),saveConfig:async()=>{}
});
await start({everythingInstance:''},'synthetic-es');
