import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {bridgeDataRoot} from '../netunim-orders/document-bridge/bridge-runtime-files.mjs';

const operations=new Map([['search','/documents/search'],['recent','/documents/recent'],['preview','/documents/preview'],['matches','/documents/matches'],['binary','/documents/preview-file']]);
export function percentile(values,fraction){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)]}
export function compareReports(current,baseline){
  if(current.machine!==baseline.machine)throw Error('baseline_machine_mismatch');
  return current.scenarios.map(row=>{
    const previous=baseline.scenarios.find(item=>item.id===row.id&&item.operation===row.operation);
    const ratio=previous?.p95Ms>0?row.p95Ms/previous.p95Ms:null;
    return {id:row.id,p95Ratio:ratio,reviewRequired:ratio!==null&&ratio>1.2};
  });
}

// Only read/preview routes are available. Inputs and response bodies remain in
// memory; reports never contain queries, filenames, paths, IDs, tokens or errors.
export async function measurePlan(plan,{token,port=8766,fetchRequest=fetch}={}){
  if(!/^computer-[1-3]$/.test(plan.machine)||!Array.isArray(plan.scenarios)||!plan.scenarios.length||plan.scenarios.length>50)throw Error('invalid_measurement_plan');
  if(!Number.isSafeInteger(port)||port<1024||port>65535||!token)throw Error('invalid_loopback_configuration');
  const repetitions=plan.repetitions??20,warmups=plan.warmups??3;
  if(!Number.isSafeInteger(repetitions)||repetitions<20||repetitions>200||!Number.isSafeInteger(warmups)||warmups<0||warmups>10)throw Error('invalid_repetitions');
  if(typeof plan.origin!=='string'||new URL(plan.origin).origin!==plan.origin)throw Error('invalid_origin');
  const ids=new Set();
  for(const scenario of plan.scenarios){
    if(!/^case-\d{2}$/.test(scenario.id)||ids.has(scenario.id)||!operations.has(scenario.operation))throw Error('invalid_scenario');
    ids.add(scenario.id);
  }
  const base=`http://127.0.0.1:${port}`;
  async function request(route,body,binary=false,keepSelection=false){
    const started=performance.now();
    try{
      const response=await fetchRequest(base+route,{method:'POST',headers:{Origin:plan.origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});
      const payload=binary&&response.ok?await response.arrayBuffer():await response.json();
      const result={wallMs:performance.now()-started,status:response.status,partial:payload?.partial===true,timings:{},...(keepSelection?{payload}:{})};
      for(const [key,value] of Object.entries(payload?.timings||{}))if(/^[a-zA-Z]+Ms$/.test(key)&&typeof value==='number'&&Number.isFinite(value)&&value>=0)result.timings[key]=value;
      return result;
    }catch{return {wallMs:performance.now()-started,status:0,partial:false,timings:{},payload:null}}
  }
  const report={schema:1,machine:plan.machine,measuredAt:new Date().toISOString(),repetitions,warmups,scenarios:[]};
  for(const scenario of plan.scenarios){
    const operation=scenario.operation,route=operations.get(operation);
    let body=scenario.search||{};
    if(['preview','matches','binary'].includes(operation)){
      const selection=await request('/documents/search',scenario.search||{},false,true);
      const selected=selection.status===200&&!selection.partial?selection.payload?.results?.[scenario.resultIndex??0]:null;
      if(!selected?.id)throw Error('preview_selection_unavailable');
      body={id:selected.id};
    }
    const first=await request(route,body,operation==='binary');
    for(let i=0;i<warmups;i++)await request(route,body,operation==='binary');
    const samples=[];
    for(let i=0;i<repetitions;i++)samples.push(await request(route,body,operation==='binary'));
    const phases={};
    for(const key of new Set(samples.flatMap(item=>Object.keys(item.timings)))){
      const values=samples.map(item=>item.timings[key]).filter(value=>typeof value==='number');
      phases[key]={p50Ms:percentile(values,.5),p95Ms:percentile(values,.95)};
    }
    report.scenarios.push({id:scenario.id,operation,firstRequestMs:first.wallMs,firstStatus:first.status,p50Ms:percentile(samples.map(item=>item.wallMs),.5),p95Ms:percentile(samples.map(item=>item.wallMs),.95),failures:samples.filter(item=>item.status!==200).length,partialResponses:samples.filter(item=>item.partial).length,phases});
  }
  return report;
}

async function main(){
  const [planFile,outputFile,baselineFile]=process.argv.slice(2);
  if(!planFile||!outputFile)throw Error('usage: node tools/measure-document-bridge.mjs PLAN OUTPUT [BASELINE]');
  const plan=JSON.parse(await fs.readFile(planFile,'utf8'));
  const token=(await fs.readFile(path.join(bridgeDataRoot(),'bridge-token.txt'),'utf8')).trim();
  const report=await measurePlan(plan,{token});
  if(baselineFile)report.comparison=compareReports(report,JSON.parse(await fs.readFile(baselineFile,'utf8')));
  await fs.writeFile(outputFile,JSON.stringify(report,null,2)+'\n',{encoding:'utf8',mode:0o600});
  console.log(`Measured ${report.scenarios.length} scenarios; report contains numeric diagnostics only.`);
  if(report.scenarios.some(row=>row.failures||row.partialResponses||row.firstStatus!==200)||report.comparison?.some(row=>row.reviewRequired))process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('Measurement failed. Check the local plan, pairing, selected folders and Bridge status. No request details were saved.');process.exitCode=1});
