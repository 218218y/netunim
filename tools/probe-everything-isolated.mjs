import {createEverythingSearchCoordinator} from '../netunim-orders/document-bridge/everything-search-coordinator.mjs';
import {createEverythingProcess} from '../netunim-orders/document-bridge/everything-process.mjs';
import {createEverythingProcessPlatform} from '../netunim-orders/document-bridge/everything-process-platform.mjs';
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
if(mode==='abort'||mode==='timeout'){
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
