import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {tokens} from './bank_policy_ast_fixture.mjs';
import {createEverythingSession} from '../netunim-orders/document-bridge/everything-session.mjs';
export const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/everything-session-policy.json',import.meta.url),'utf8'));
for(const entry of Object.values(baseline.functions))if(createHash('sha256').update(tokens(entry.source)).digest('hex')!==entry.digest)throw new Error('modified_everything_baseline');
const names=['instanceArgs','instanceCandidates','probeRunningInstances','waitForEverything','startEverythingBackground','probeEverything'];
const script=new vm.Script('let cachedProbe=null,everythingProbePromise=null,everythingStartPromise=null;\n'+names.map(name=>baseline.functions[name].source).join('\n')+'\n({probe:probeEverything,invalidate:()=>{cachedProbe=null}})');
export const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
export const plain=value=>JSON.parse(JSON.stringify(value));
export function fixture(version='current',options={}){
 let time=1000,config={everythingInstance:options.preferred||'',everythingExecutable:'',searchTimeoutMs:15000,allowedOrigins:[]},starts=0;
 const calls=[],saves=[],logs=[];
 const ports={configuration:{load:async()=>{calls.push(['config']);return options.load?options.load():{...config}},save:async value=>{saves.push({...value});config={...value};if(options.save)await options.save(value)}},
  discovery:{es:async()=>{calls.push(['es']);return 'synthetic-es'},executable:async value=>{calls.push(['executable']);return options.executable?options.executable(value):'C:\\Everything 1.5a\\Everything.exe'}},
  process:{run:async(file,args,opts)=>{calls.push([file,args,opts]);if(options.run)return options.run(file,args,opts,starts);if(args[0]==='-version')return {stdout:' ES1 \n'};return {stdout:' 1.5.0 \n'}},start:(file,args)=>{starts++;calls.push(['start',file,args])}},
  runtime:{now:()=>time,wait:async ms=>{calls.push(['wait',ms]);time+=ms;if(options.wait)await options.wait(ms)}},audit:{write:async text=>{logs.push(text);if(options.audit)await options.audit(text)}}};
 const context={Date:{now:ports.runtime.now},setTimeout:callback=>{ports.runtime.wait(250).then(callback)},
  loadConfig:ports.configuration.load,saveConfig:ports.configuration.save,whereEs:ports.discovery.es,findEverythingExecutable:ports.discovery.executable,runEs:ports.process.run,appendLog:ports.audit.write,
  APP_ROOT:'synthetic-root',spawn:(file,args)=>{ports.process.start(file,args);return{unref:()=>{}}}};
 const owner=version==='baseline'?script.runInNewContext(context):createEverythingSession(ports);
 return {owner,ports,calls,saves,logs,setTime:value=>{time=value},starts:()=>starts,observation:()=>plain({calls,saves,logs,starts,time})};
}
