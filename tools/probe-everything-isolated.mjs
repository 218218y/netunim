import {createEverythingSearchCoordinator} from '../netunim-orders/document-bridge/everything-search-coordinator.mjs';
import {createEverythingProcess} from '../netunim-orders/document-bridge/everything-process.mjs';
import {createEverythingProcessPlatform} from '../netunim-orders/document-bridge/everything-process-platform.mjs';
import {buildEsSearchArgs,parseEsContentRows} from '../netunim-orders/document-bridge/lib.mjs';
import {execFile} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const [instance,esPath,root,mode='search',legacyQuery]=process.argv.slice(2);
const workspace=fileURLToPath(new URL('../.work/',import.meta.url));
if(!/^NETUNIM_VERIFY_[a-f0-9]{32}$/.test(instance||'')||!root||!esPath)throw Error('isolated probe arguments required');
const resolved=await fs.realpath(root),ownedParent=await fs.realpath(workspace);
if(path.dirname(resolved)!==ownedParent||!/^everything-isolated-[a-f0-9]{32}$/.test(path.basename(resolved)))throw Error('probe root is outside its disposable workspace');
if(await fs.realpath(esPath)!==path.join(resolved,'es.exe'))throw Error('probe must execute only its copied ES binary');
const owner=createEverythingProcess(createEverythingProcessPlatform({root}));
if(mode==='resources'){
 const contentSearch={matchMode:'proximity',proximityWords:0,wordMatch:'partial'},sort={field:'name',direction:'asc'};
 const scope=folder=>path.join(root,'fixtures',folder),observations=[];
 async function measure(name,work){
  const started=performance.now(),before=process.memoryUsage();
  try{const result=await work();observations.push({case:name,wallMs:performance.now()-started,memoryBefore:before,memoryAfter:process.memoryUsage(),...result});return result}
  catch(error){observations.push({case:name,wallMs:performance.now()-started,code:error.code});throw error}
 }
 const nativeArgs=(folder,limit)=>buildEsSearchArgs({query:'resource_start resource_end',mode:'content',contentSearch,scopePath:scope(folder),sort,limit,offset:0,timeoutMs:10000,instance});
 async function expectLimit(folder,limit){
  try{await owner.es(esPath,nativeArgs(folder,limit));assert.fail('native output unexpectedly fit')}
  catch(error){assert.equal(error.code,'ES_OUTPUT_LIMIT');return {code:error.code}}
 }
 function coordinatorFor(processOwner,attempts,published){
  return createEverythingSearchCoordinator({
   configuration:{load:async()=>({searchTimeoutMs:10000})},
   session:{probe:async()=>({esPath,instance}),executable:async()=>'',invalidate:()=>{}},
   process:{run:async(file,args,options)=>{
    const limit=Number(args[args.indexOf('-max-results')+1]),offset=args.includes('-offset')?Number(args[args.indexOf('-offset')+1]):0;
    try{const result=await processOwner.es(file,args,options);attempts.push({limit,offset,bytes:Buffer.byteLength(result.stdout)});return result}
    catch(error){attempts.push({limit,offset,code:error.code});throw error}
   }},
   pdf:{prepare:async()=>({partial:false}),search:()=>[]},
   publication:{prune:()=>{},publish:row=>{published.push(row.name);return row}},audit:{write:async()=>{}}
  });
 }
 async function searchCase(folder,limit,offset=0){
  const attempts=[],published=[],coordinator=coordinatorFor(owner,attempts,published);
  try{const result=await coordinator.searchDocuments('resource_start resource_end',limit,'content',contentSearch,scope(folder),offset,sort);
   return {names:result.results.map(row=>row.name),partial:result.partial,hasMore:result.hasMore,attempts,published:published.length};
  }catch(error){return {code:error.code,attempts,published:published.length}}
  finally{await coordinator.runtime.dispose()}
 }
 try{
  await measure('native-100-overflow',()=>expectLimit('resource-batch',100));
  await measure('native-25-success',async()=>{
   const {stdout}=await owner.es(esPath,nativeArgs('resource-batch',25));
   const rows=parseEsContentRows(stdout);assert.equal(rows.length,25);
   assert.ok(rows.every(row=>row.content.endsWith('padding ')));
   return {rows:rows.length,bytes:Buffer.byteLength(stdout),contentCharacters:rows.reduce((sum,row)=>sum+row.content.length,0)};
  });
  await measure('native-single-overflow',()=>expectLimit('resource-single',1));
  await measure('adaptive-complete',async()=>{
   const result=await searchCase('resource-batch',150);
   assert.deepEqual(result.names,Array.from({length:100},(_,i)=>`large-${String(i).padStart(3,'0')}.txt`));
   assert.equal(result.partial,false);assert.equal(result.hasMore,false);
   assert.equal(result.attempts[0].code,'ES_OUTPUT_LIMIT');assert.equal(result.attempts[1].offset,0);
   return result;
  });
  await measure('adaptive-filtered-offset',async()=>{
   const result=await searchCase('resource-filter',10,20);
   assert.deepEqual(result.names,Array.from({length:10},(_,i)=>`b-valid-${String(i+20).padStart(3,'0')}.txt`));
   assert.equal(result.partial,false);assert.equal(result.hasMore,true);return result;
  });
  await measure('adaptive-single-rejected',async()=>{
   const result=await searchCase('resource-single',10);
   assert.equal(result.code,'ES_CONTENT_TOO_LARGE');assert.equal(result.published,0);return result;
  });
  for(const termination of ['abort','timeout'])await measure(`large-output-${termination}`,async()=>{
   const controller=new AbortController(),attempts=[],published=[];let bytesBeforeStop=0,stopped=false;
   // Terminate a real native read after at least 64 KiB of stdout. The timeout
   // case injects the same SIGTERM used by execFile's deadline, without a race
   // against this computer's startup speed. No synthetic process output.
   const controlled=createEverythingProcess({commands:{execute:(file,args,options)=>new Promise((resolve,reject)=>{
    const child=execFile(file,args,{encoding:'utf8',windowsHide:true,cwd:root,maxBuffer:16*1024*1024,timeout:options.timeout,signal:options.signal},(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr}));
    child.stdout.on('data',chunk=>{
     if(stopped)return;
     bytesBeforeStop+=Buffer.byteLength(chunk);
     if(bytesBeforeStop<65536)return;
     stopped=true;if(termination==='abort')controller.abort();else child.kill();
    });
   }),launch:async()=>{throw Error('launch forbidden in resource read')}}});
   const coordinator=coordinatorFor(controlled,attempts,published);
   try{
    await assert.rejects(coordinator.searchDocuments('resource_start resource_end',150,'content',contentSearch,scope('resource-batch'),0,sort,'all',controller.signal),error=>termination==='abort'?error.name==='AbortError':error.code==='ES_TIMEOUT');
    assert.ok(bytesBeforeStop>=65536);assert.equal(published.length,0);
    return {code:attempts[0].code,bytesBeforeStop,published:published.length};
   }finally{await coordinator.runtime.dispose();await controlled.dispose()}
  });
  console.log(JSON.stringify({observations}));
 }finally{await owner.dispose()}
}else if(mode==='abort'||mode==='timeout'){
 const controller=new AbortController();let timer;
 if(mode==='abort')timer=setTimeout(()=>controller.abort(),100);
 try{await owner.es(esPath,['-instance',instance,'-argv','-cp','65001','-ipc3','-full-path-and-name','--',legacyQuery],{signal:controller.signal,timeout:mode==='timeout'?100:5000});console.log(JSON.stringify({unexpectedSuccess:true}));}
 catch(error){console.log(JSON.stringify({name:error.name,code:error.code}));}
 finally{clearTimeout(timer);await owner.dispose()}
}else{
 const coordinator=createEverythingSearchCoordinator({
  configuration:{load:async()=>({searchTimeoutMs:1000})},
  session:{probe:async()=>({esPath,instance}),executable:async()=>'',invalidate:()=>{}},
  process:{run:owner.es},pdf:{prepare:async()=>({partial:false}),search:()=>[]},
  publication:{prune:()=>{},publish:row=>row},audit:{write:async()=>{}}
 });
 try{
  const whole=mode==='whole-boundaries';
  const result=await coordinator.searchDocuments(whole?'alpha beta':'אב אב אב אב אב אין',10,'content',{matchMode:'proximity',proximityWords:whole?0:50,wordMatch:whole?'whole':'partial'},'',0,{field:'name',direction:'asc'});
  console.log(JSON.stringify({names:result.results.map(row=>row.name),elapsedMs:result.elapsedMs,partial:result.partial}));
 }
 finally{await coordinator.runtime.dispose();await owner.dispose()}
}
