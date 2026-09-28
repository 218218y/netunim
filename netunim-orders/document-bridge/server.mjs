import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto,{timingSafeEqual} from 'node:crypto';
import {execFile as execFileCb,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {
  BRIDGE_PORT,BRIDGE_SERVICE,BRIDGE_VERSION,DEFAULT_ALLOWED_ORIGINS,DEFAULT_RESULT_LIMIT,MAX_RESULTS,RECENT_RESULT_LIMIT,RESULT_TTL_MS,
  buildContentMatchInfo,buildDocumentQuery,buildEsContentPreviewArgs,buildEsCountArgs,buildEsRawSearchArgs,buildEsRecentFilesArgs,buildEsSearchArgs,mergeDocumentResults,normalizeDocumentSearchMode,normalizeSearchText,
  officePreviewKind,structuredPreviewKind,originAllowed,parseEsContentPreview,parseEsCount,parseEsJson,parseRegistryInstallLocation,
} from './lib.mjs';

const execFile=promisify(execFileCb);
const APP_ROOT=process.env.NETUNIM_DOCUMENT_BRIDGE_HOME||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'NetunimDocumentBridge');
const CONFIG_PATH=path.join(APP_ROOT,'config.json');
const TOKEN_PATH=path.join(APP_ROOT,'bridge-token.txt');
const LOG_PATH=path.join(APP_ROOT,'bridge.log');
const SUMMARY_PATH=path.join(APP_ROOT,'INSTALLATION-LOG.txt');
const TOOL_ES=path.join(APP_ROOT,'tools','es.exe');
const NATIVE_PREVIEW_HOST=path.join(APP_ROOT,'app','NetunimPreviewHost.exe');
const requestResults=new Map();
const previewTextCache=new Map();
const TEXT_PREVIEW_MAX_BYTES=1024*1024;
const BINARY_PREVIEW_MAX_BYTES=64*1024*1024;
const STRUCTURED_PREVIEW_MAX_BYTES=64*1024*1024;
const TEXT_PREVIEW_MAX_CHARS=600000;
const PREVIEW_TEXT_CACHE_TTL_MS=10*60*1000;
const PREVIEW_TEXT_CACHE_MAX=24;
const TEXT_EXTENSIONS=new Set(['txt','log','md','markdown','csv','tsv','json','xml','yaml','yml','ini','cfg','conf','sql','js','mjs','cjs','ts','tsx','jsx','css','scss','less','html','htm']);
const BINARY_PREVIEW_MIME=new Map([['pdf','application/pdf'],['png','image/png'],['jpg','image/jpeg'],['jpeg','image/jpeg'],['gif','image/gif'],['webp','image/webp'],['bmp','image/bmp'],['svg','image/svg+xml']]);
const STRUCTURED_PREVIEW_MIME=new Map([['docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['docm','application/vnd.ms-word.document.macroEnabled.12'],['dotx','application/vnd.openxmlformats-officedocument.wordprocessingml.template'],['dotm','application/vnd.ms-word.template.macroEnabled.12'],['xls','application/vnd.ms-excel'],['xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['xlsm','application/vnd.ms-excel.sheet.macroEnabled.12'],['xlsb','application/vnd.ms-excel.sheet.binary.macroEnabled.12'],['xlt','application/vnd.ms-excel'],['xltx','application/vnd.openxmlformats-officedocument.spreadsheetml.template'],['xltm','application/vnd.ms-excel.template.macroEnabled.12']]);
let server=null,cachedProbe=null,cachedEsPath='',everythingProbePromise=null,everythingStartPromise=null,nativePreviewProcess=null,nativePreviewBuffer='',nativePreviewSequence=0;
const nativePreviewPending=new Map();

async function ensureRoot(){await fs.mkdir(APP_ROOT,{recursive:true})}
async function appendLog(message){try{await ensureRoot();await fs.appendFile(LOG_PATH,`${new Date().toISOString()} ${message}\n`,'utf8')}catch{}}
async function readJsonFile(file,fallback){try{return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''))}catch{return fallback}}
async function writeJsonFile(file,value){await ensureRoot();const tmp=`${file}.tmp`;await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',mode:0o600});await fs.rename(tmp,file)}
async function ensureToken(){await ensureRoot();try{const token=(await fs.readFile(TOKEN_PATH,'utf8')).trim();if(token)return token}catch{}const token=crypto.randomBytes(32).toString('hex');await fs.writeFile(TOKEN_PATH,token+'\n',{encoding:'utf8',mode:0o600});return token}
async function loadConfig(){
  const raw=await readJsonFile(CONFIG_PATH,{});
  return {
    everythingInstance:String(raw.everythingInstance||'').trim(),
    everythingExecutable:String(raw.everythingExecutable||'').trim(),
    allowedOrigins:Array.isArray(raw.allowedOrigins)&&raw.allowedOrigins.length?raw.allowedOrigins.map(String):DEFAULT_ALLOWED_ORIGINS,
    searchTimeoutMs:Math.max(3000,Math.min(30000,Number(raw.searchTimeoutMs)||15000)),
  };
}
async function saveConfig(config){await writeJsonFile(CONFIG_PATH,{everythingInstance:String(config.everythingInstance||'').trim(),everythingExecutable:String(config.everythingExecutable||'').trim(),allowedOrigins:Array.isArray(config.allowedOrigins)&&config.allowedOrigins.length?config.allowedOrigins:DEFAULT_ALLOWED_ORIGINS,searchTimeoutMs:Math.max(3000,Math.min(30000,Number(config.searchTimeoutMs)||15000))})}
async function init(){await ensureToken();const existing=await loadConfig();if(!fsSync.existsSync(CONFIG_PATH))await saveConfig(existing);return existing}
async function existsFile(candidate){if(!candidate)return false;try{return (await fs.stat(candidate)).isFile()}catch{return false}}

async function whereEs(){
  if(cachedEsPath)return cachedEsPath;
  const candidates=[process.env.NETUNIM_EVERYTHING_ES_PATH,TOOL_ES,path.join(process.env.LOCALAPPDATA||'','Microsoft','WindowsApps','es.exe'),path.join(process.env.PROGRAMFILES||'C:\\Program Files','Everything','es.exe'),path.join(process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)','Everything','es.exe')].filter(Boolean);
  for(const candidate of candidates)if(await existsFile(candidate)){cachedEsPath=candidate;return cachedEsPath}
  if(process.platform==='win32')try{const {stdout}=await execFile('where.exe',['es.exe'],{encoding:'utf8',windowsHide:true,timeout:3000});const candidate=stdout.split(/\r?\n/).map(x=>x.trim()).find(Boolean);if(candidate){cachedEsPath=candidate;return cachedEsPath}}catch{}
  const e=new Error('es.exe לא נמצא. יש להריץ מחדש את מתקין Document Bridge.');e.code='ES_NOT_FOUND';throw e;
}
function instanceArgs(instance){return instance?['-instance',instance]:[]}
async function runEs(esPath,args,{timeout=18000}={}){
  try{return await execFile(esPath,args,{encoding:'utf8',windowsHide:true,timeout,maxBuffer:16*1024*1024})}
  catch(error){const e=new Error(String(error?.stderr||error?.message||'ES failed').trim()||'ES failed');e.code=`ES_EXIT_${Number.isFinite(Number(error?.code))?Number(error.code):'ERROR'}`;e.exitCode=Number(error?.code);e.stderr=String(error?.stderr||'');throw e}
}
function instanceCandidates(config){return [...new Set([config.everythingInstance,'','1.5a'].filter(value=>value!==undefined&&value!==null))]}
async function probeRunningInstances(config,esPath){
  let esVersion='';try{esVersion=(await runEs(esPath,['-version'],{timeout:3000})).stdout.trim()}catch{}
  const probeOne=async instance=>{
    const {stdout}=await runEs(esPath,['-ipc3',...instanceArgs(instance),'-timeout','3000','-get-everything-version'],{timeout:4500});
    return {at:Date.now(),esPath,esVersion,everythingVersion:stdout.trim(),instance,startedByBridge:false};
  };
  const preferred=String(config.everythingInstance||'').trim();
  if(preferred){
    try{return await probeOne(preferred)}catch{}
  }
  const candidates=instanceCandidates(config).filter(instance=>!preferred||instance!==preferred);
  try{return await Promise.any(candidates.map(instance=>probeOne(instance)))}catch(aggregate){
    const errors=Array.isArray(aggregate?.errors)?aggregate.errors:[];
    const onlyNotRunning=errors.length>0&&errors.every(error=>error?.exitCode===8);
    const e=new Error(onlyNotRunning?'Everything אינו פועל כרגע.':'לא ניתן להתחבר ל-Everything המקומי.');
    e.code=onlyNotRunning?'EVERYTHING_NOT_RUNNING':'EVERYTHING_UNAVAILABLE';e.cause=errors.at(-1)||aggregate;throw e;
  }
}
async function registryValue(key,value='InstallLocation'){
  if(process.platform!=='win32')return '';
  try{const {stdout}=await execFile('reg.exe',['query',key,'/v',value],{encoding:'utf8',windowsHide:true,timeout:3000});return parseRegistryInstallLocation(stdout,value)}catch{return ''}
}
function executableNamesForLocation(location){return location?[path.win32.join(location,'Everything.exe'),path.win32.join(location,'Everything64.exe')]:[]}
async function findEverythingExecutable(config){
  const direct=[process.env.NETUNIM_EVERYTHING_EXE_PATH,config.everythingExecutable].filter(Boolean);
  for(const candidate of direct)if(await existsFile(candidate))return candidate;

  const registryKeys=[
    'HKLM\\SOFTWARE\\voidtools\\Everything',
    'HKCU\\SOFTWARE\\voidtools\\Everything',
    'HKLM\\SOFTWARE\\voidtools\\Everything 1.5a',
    'HKCU\\SOFTWARE\\voidtools\\Everything 1.5a',
    'HKLM\\SOFTWARE\\WOW6432Node\\voidtools\\Everything',
    'HKLM\\SOFTWARE\\WOW6432Node\\voidtools\\Everything 1.5a',
  ];
  for(const key of registryKeys){
    const location=await registryValue(key);
    for(const candidate of executableNamesForLocation(location))if(await existsFile(candidate))return candidate;
  }

  const programFiles=process.env.PROGRAMFILES||'C:\\Program Files';
  const programFilesX86=process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)';
  const localAppData=process.env.LOCALAPPDATA||'';
  const known=[
    ...executableNamesForLocation(path.join(programFiles,'Everything')),
    ...executableNamesForLocation(path.join(programFiles,'Everything 1.5a')),
    ...executableNamesForLocation(path.join(programFilesX86,'Everything')),
    ...executableNamesForLocation(path.join(programFilesX86,'Everything 1.5a')),
    ...executableNamesForLocation(path.join(localAppData,'Everything')),
    ...executableNamesForLocation(path.join(localAppData,'Programs','Everything')),
  ];
  for(const candidate of known)if(await existsFile(candidate))return candidate;

  if(process.platform==='win32'){
    for(const exeName of ['Everything.exe','Everything64.exe']){
      try{const {stdout}=await execFile('where.exe',[exeName],{encoding:'utf8',windowsHide:true,timeout:3000});for(const candidate of stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean))if(await existsFile(candidate))return candidate}catch{}
    }
  }
  const e=new Error('Everything מותקן אך לא ניתן לאתר את Everything.exe. התקן את Everything 1.5 באמצעות המתקין הרשמי או הגדר NETUNIM_EVERYTHING_EXE_PATH.');e.code='EVERYTHING_EXE_NOT_FOUND';throw e;
}
async function waitForEverything(config,esPath,timeoutMs=15000){
  const deadline=Date.now()+timeoutMs,lastErrors=[];
  while(Date.now()<deadline){
    try{return await probeRunningInstances(config,esPath)}catch(error){lastErrors.push(error);await new Promise(resolve=>setTimeout(resolve,250))}
  }
  const e=new Error('Everything הופעל ברקע אך לא היה מוכן לחיפוש בזמן.');e.code='EVERYTHING_START_TIMEOUT';e.cause=lastErrors.at(-1);throw e;
}
async function startEverythingBackground(config,esPath){
  if(everythingStartPromise)return everythingStartPromise;
  everythingStartPromise=(async()=>{
    const executable=await findEverythingExecutable(config);
    const instance=config.everythingInstance||(/1\.5a/i.test(executable)?'1.5a':'');
    const args=[...instanceArgs(instance),'-startup','-first-instance'];
    await appendLog(`EVERYTHING_START exe=${executable} instance=${instance||'(default)'}`);
    const child=spawn(executable,args,{detached:true,windowsHide:true,stdio:'ignore'});child.unref();
    const probe=await waitForEverything({...config,everythingInstance:instance},esPath,15000);
    const latest=await loadConfig();
    if(latest.everythingExecutable!==executable||latest.everythingInstance!==probe.instance){latest.everythingExecutable=executable;latest.everythingInstance=probe.instance;await saveConfig(latest)}
    return {...probe,startedByBridge:true,everythingExecutable:executable};
  })();
  try{return await everythingStartPromise}finally{everythingStartPromise=null}
}
async function probeEverything({fresh=false,autoStart=true}={}){
  if(!fresh&&cachedProbe&&Date.now()-cachedProbe.at<30000)return cachedProbe;
  if(everythingProbePromise)return everythingProbePromise;
  const task=(async()=>{
    const config=await loadConfig(),esPath=await whereEs();
    let probe;
    try{probe=await probeRunningInstances(config,esPath)}catch(error){
      if(error.code!=='EVERYTHING_NOT_RUNNING'||!autoStart)throw error;
      probe=await startEverythingBackground(config,esPath);
    }
    cachedProbe=probe;
    if(config.everythingInstance!==probe.instance){config.everythingInstance=probe.instance;await saveConfig(config)}
    return cachedProbe;
  })();
  everythingProbePromise=task;
  try{return await task}finally{if(everythingProbePromise===task)everythingProbePromise=null}
}

async function countIndex({esPath,instance},config,search='*'){
  const args=buildEsCountArgs({search,timeoutMs:config.searchTimeoutMs,instance,filesOnly:true});
  const {stdout}=await runEs(esPath,args,{timeout:config.searchTimeoutMs+3000});
  return parseEsCount(stdout);
}
async function sampleIndex({esPath,instance},config){
  const args=buildEsRawSearchArgs({search:'*',limit:1,timeoutMs:config.searchTimeoutMs,instance,filesOnly:false});
  const {stdout}=await runEs(esPath,args,{timeout:config.searchTimeoutMs+3000});
  return parseEsJson(stdout);
}
async function diagnoseIndex({freshProbe=false}={}){
  const config=await loadConfig();let probe=await probeEverything({fresh:freshProbe,autoStart:true});
  if(!probe.everythingExecutable){try{probe={...probe,everythingExecutable:await findEverythingExecutable(config)}}catch{}}
  let fileCount=null,indexedContentCount=null,sampleOk=false,error='';
  try{
    fileCount=await countIndex(probe,config,'*');
    indexedContentCount=await countIndex(probe,config,'is-indexed-property:content');
    if(fileCount>0)sampleOk=(await sampleIndex(probe,config)).length>0;
  }catch(err){error=String(err?.message||err)}
  return {config,probe,diagnostics:{fileCount,indexedContentCount,sampleOk,error}};
}

function pruneResults(){const now=Date.now();for(const [id,row] of requestResults)if(row.expiresAt<=now)requestResults.delete(id)}
function publicResult(row,{query='',mode='everything'}={}){const id=crypto.randomUUID();requestResults.set(id,{fullPath:row.fullPath,query:String(query||''),mode:normalizeDocumentSearchMode(mode),expiresAt:Date.now()+RESULT_TTL_MS});return {id,name:row.name,relativePath:row.relativePath,modified:row.modified,size:row.size,extension:row.extension,attributes:row.attributes||'',isDirectory:!!row.isDirectory,rootId:'everything',rootLabel:'Everything'}}
async function runEverythingJson(buildArgs){
  const config=await loadConfig();let probe=await probeEverything({autoStart:true});const started=Date.now();
  const runSearch=currentProbe=>runEs(currentProbe.esPath,buildArgs(config,currentProbe),{timeout:config.searchTimeoutMs+5000});
  let output;
  try{output=await runSearch(probe)}catch(error){
    if(error?.exitCode!==8)throw error;
    cachedProbe=null;probe=await probeEverything({fresh:true,autoStart:true});output=await runSearch(probe);
  }
  return {rows:parseEsJson(output.stdout),elapsedMs:Date.now()-started};
}
async function searchDocuments(query,limit,mode='everything'){
  const normalizedMode=normalizeDocumentSearchMode(mode),everythingQuery=buildDocumentQuery(query,normalizedMode);
  if(!everythingQuery){const e=new Error(normalizedMode==='content'?'יש להקליד לפחות שני תווים לחיפוש בתוכן הקבצים.':'יש להקליד לפחות תו אחד לחיפוש ב-Everything.');e.code='QUERY_TOO_SHORT';throw e}
  const boundedLimit=Math.min(MAX_RESULTS,Number(limit)||DEFAULT_RESULT_LIMIT);
  const {rows,elapsedMs}=await runEverythingJson((config,probe)=>buildEsSearchArgs({query,mode:normalizedMode,limit:boundedLimit,timeoutMs:config.searchTimeoutMs,instance:probe.instance}));
  pruneResults();const merged=mergeDocumentResults([rows],boundedLimit).map(row=>publicResult(row,{query,mode:normalizedMode}));
  await appendLog(`SEARCH mode=${normalizedMode} scope=everything-index results=${merged.length} elapsedMs=${elapsedMs} input=${JSON.stringify(String(query||''))} everythingQuery=${JSON.stringify(everythingQuery)}`);
  return {ok:true,bridgeVersion:BRIDGE_VERSION,query:String(query||'').trim(),mode:normalizedMode,results:merged,elapsedMs,partial:false,rootErrors:[]};
}
async function recentDocuments(limit){
  const boundedLimit=Math.min(RECENT_RESULT_LIMIT,Math.max(1,Number(limit)||RECENT_RESULT_LIMIT));
  const {rows,elapsedMs}=await runEverythingJson((config,probe)=>buildEsRecentFilesArgs({limit:boundedLimit,timeoutMs:config.searchTimeoutMs,instance:probe.instance}));
  pruneResults();const results=mergeDocumentResults([rows],boundedLimit,RECENT_RESULT_LIMIT).map(row=>publicResult(row,{query:'',mode:'everything'}));
  await appendLog(`RECENT scope=everything-index files-only=true sort=date-modified-descending results=${results.length} elapsedMs=${elapsedMs}`);
  return {ok:true,mode:'recent',results,elapsedMs,partial:false,rootErrors:[]};
}

async function resolveResult(id){
  pruneResults();
  const row=requestResults.get(String(id||''));
  if(!row){const e=new Error('תוצאת החיפוש פגה. חפש שוב את הקובץ.');e.code='RESULT_EXPIRED';throw e}
  let stat;try{stat=await fs.stat(row.fullPath)}catch{const e=new Error('הקובץ כבר אינו קיים או שאינו נגיש.');e.code='OPEN_TARGET_MISSING';throw e}
  return {row,stat};
}

function decodeTextBuffer(buffer){
  if(buffer.length>=3&&buffer[0]===0xef&&buffer[1]===0xbb&&buffer[2]===0xbf)return new TextDecoder('utf-8').decode(buffer.subarray(3));
  if(buffer.length>=2&&buffer[0]===0xff&&buffer[1]===0xfe)return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if(buffer.length>=2&&buffer[0]===0xfe&&buffer[1]===0xff)return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer)}catch{}
  try{return new TextDecoder('windows-1255').decode(buffer)}catch{return buffer.toString('latin1')}
}
function trimPreviewText(value){const text=String(value??'').replace(/\u0000/g,'');return {text:text.slice(0,TEXT_PREVIEW_MAX_CHARS),truncated:text.length>TEXT_PREVIEW_MAX_CHARS}}
async function readTextPreview(fullPath,stat){
  const length=Math.min(Number(stat.size)||0,TEXT_PREVIEW_MAX_BYTES),handle=await fs.open(fullPath,'r');
  try{const buffer=Buffer.alloc(length);const {bytesRead}=await handle.read(buffer,0,length,0);const decoded=decodeTextBuffer(buffer.subarray(0,bytesRead));const result=trimPreviewText(decoded);return {...result,truncated:result.truncated||Number(stat.size)>length}}finally{await handle.close()}
}
function rejectNativePreviewPending(error){
  for(const [,pending] of nativePreviewPending){clearTimeout(pending.timer);pending.reject(error)}
  nativePreviewPending.clear();
}
function handleNativePreviewOutput(chunk){
  nativePreviewBuffer+=String(chunk||'');
  while(true){
    const index=nativePreviewBuffer.indexOf('\n');if(index<0)break;
    const line=nativePreviewBuffer.slice(0,index).replace(/\r$/,'');nativePreviewBuffer=nativePreviewBuffer.slice(index+1);
    if(!line)continue;
    const [id,status,...rest]=line.split('\t'),pending=nativePreviewPending.get(id);if(!pending)continue;
    nativePreviewPending.delete(id);clearTimeout(pending.timer);const message=rest.join('\t');
    if(status==='OK')pending.resolve(message);else{const error=new Error(message||'Windows Preview Handler failed.');error.code='NATIVE_PREVIEW_FAILED';pending.reject(error)}
  }
}
async function ensureNativePreviewProcess(){
  if(process.platform!=='win32'){const e=new Error('Windows Preview Handler זמין רק ב-Windows.');e.code='WINDOWS_REQUIRED';throw e}
  if(nativePreviewProcess&&!nativePreviewProcess.killed&&nativePreviewProcess.exitCode===null)return nativePreviewProcess;
  if(!(await existsFile(NATIVE_PREVIEW_HOST))){const e=new Error('רכיב Windows Preview Handler לא הותקן. הרץ מחדש את מתקין Document Bridge.');e.code='NATIVE_PREVIEW_HOST_MISSING';throw e}
  nativePreviewBuffer='';
  const child=spawn(NATIVE_PREVIEW_HOST,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});nativePreviewProcess=child;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',handleNativePreviewOutput);child.stderr.on('data',data=>appendLog(`NATIVE_PREVIEW_STDERR ${JSON.stringify(String(data||'').trim())}`));
  child.on('error',error=>{if(nativePreviewProcess===child)nativePreviewProcess=null;rejectNativePreviewPending(Object.assign(new Error(`Windows Preview Handler host failed: ${error.message}`),{code:'NATIVE_PREVIEW_HOST_FAILED'}))});
  child.on('exit',(code,signal)=>{if(nativePreviewProcess===child)nativePreviewProcess=null;rejectNativePreviewPending(Object.assign(new Error(`Windows Preview Handler host exited (${code??signal??'unknown'}).`),{code:'NATIVE_PREVIEW_HOST_EXITED'}))});
  await nativePreviewCommand('PING',[],4000);return child;
}
async function nativePreviewCommand(command,args=[],timeoutMs=6000){
  const child=command==='PING'&&nativePreviewProcess?nativePreviewProcess:await ensureNativePreviewProcess();
  if(!child?.stdin?.writable){const e=new Error('Windows Preview Handler host is not writable.');e.code='NATIVE_PREVIEW_HOST_FAILED';throw e}
  const id=String(++nativePreviewSequence),fields=[id,String(command),...args.map(value=>String(value??'').replace(/[\r\n\t]/g,' '))];
  return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{nativePreviewPending.delete(id);const e=new Error('Windows Preview Handler did not respond in time.');e.code='NATIVE_PREVIEW_TIMEOUT';reject(e)},timeoutMs);nativePreviewPending.set(id,{resolve,reject,timer});child.stdin.write(fields.join('\t')+'\n','utf8',error=>{if(!error)return;const pending=nativePreviewPending.get(id);if(!pending)return;nativePreviewPending.delete(id);clearTimeout(timer);reject(error)})});
}
function normalizePreviewGeometry(value){
  const source=value&&typeof value==='object'?value:{};
  const integer=(name,fallback,min,max)=>Math.max(min,Math.min(max,Math.round(Number(source[name])||fallback)));
  return {x:integer('x',0,-20000,20000),y:integer('y',0,-20000,20000),width:integer('width',900,200,5000),height:integer('height',700,160,4000)};
}
async function openNativePreview(id,geometry){
  const {row,stat}=await resolveResult(id);if(stat.isDirectory()){const e=new Error('לתיקייה אין Windows Preview Handler של מסמך.');e.code='NATIVE_PREVIEW_NOT_FILE';throw e}
  const extension=path.win32.extname(row.fullPath).replace(/^\./,'').toLowerCase(),officeKind=officePreviewKind(extension);if(!officeKind){const e=new Error('תצוגת Windows המקורית מופעלת כרגע למסמכי Office בלבד.');e.code='NATIVE_PREVIEW_UNSUPPORTED';throw e}
  const box=normalizePreviewGeometry(geometry),encoded=Buffer.from(row.fullPath,'utf8').toString('base64');
  const response=await nativePreviewCommand('OPEN',[encoded,box.x,box.y,box.width,box.height],9000);await appendLog(`NATIVE_PREVIEW_OPEN kind=${officeKind} geometry=${box.x},${box.y},${box.width}x${box.height} handler=${JSON.stringify(response)} path=${JSON.stringify(row.fullPath)}`);return {ok:true,kind:'native',officeKind};
}
async function moveNativePreview(geometry){const box=normalizePreviewGeometry(geometry);if(!nativePreviewProcess)return {ok:true,visible:false};await nativePreviewCommand('MOVE',[box.x,box.y,box.width,box.height],2500);return {ok:true,visible:true}}
async function hideNativePreview(){if(!nativePreviewProcess)return {ok:true};try{await nativePreviewCommand('HIDE',[],2500)}catch{}return {ok:true}}
async function stopNativePreview(){const child=nativePreviewProcess;if(!child)return;try{await nativePreviewCommand('EXIT',[],1500)}catch{}try{child.kill()}catch{}nativePreviewProcess=null}
async function readEverythingContentPreview(fullPath){
  try{
    const config=await loadConfig(),probe=await probeEverything({autoStart:true});
    const args=buildEsContentPreviewArgs({fullPath,timeoutMs:config.searchTimeoutMs,instance:probe.instance});
    const {stdout}=await runEs(probe.esPath,args,{timeout:config.searchTimeoutMs+5000});
    const content=parseEsContentPreview(stdout);if(!content)return null;return trimPreviewText(content);
  }catch(error){await appendLog(`PREVIEW_CONTENT_FAILED path=${JSON.stringify(fullPath)} error=${JSON.stringify(String(error?.message||error))}`);return null}
}
function prunePreviewTextCache(){
  const now=Date.now();for(const [key,value] of previewTextCache)if(now-value.at>PREVIEW_TEXT_CACHE_TTL_MS)previewTextCache.delete(key);
  while(previewTextCache.size>PREVIEW_TEXT_CACHE_MAX)previewTextCache.delete(previewTextCache.keys().next().value);
}
async function searchablePreviewText(row,stat){
  prunePreviewTextCache();const key=String(row.fullPath||'').toLocaleLowerCase('en-US'),fingerprint=`${Number(stat.size)||0}:${Number(stat.mtimeMs)||0}`;
  const cached=previewTextCache.get(key);if(cached&&cached.fingerprint===fingerprint){cached.at=Date.now();previewTextCache.delete(key);previewTextCache.set(key,cached);return cached.data}
  const extension=path.win32.extname(row.fullPath).replace(/^\./,'').toLowerCase();let data=null;
  if(TEXT_EXTENSIONS.has(extension)){const direct=await readTextPreview(row.fullPath,stat);data={...direct,source:'file'}}
  else{const extracted=await readEverythingContentPreview(row.fullPath);if(extracted)data={...extracted,source:'everything-content'}}
  if(data){previewTextCache.set(key,{fingerprint,at:Date.now(),data});prunePreviewTextCache()}
  return data;
}
async function previewMatches(id){
  const {row,stat}=await resolveResult(id),query=normalizeSearchText(row.query);
  if(row.mode!=='content'||query.length<2||stat.isDirectory())return {ok:true,active:false,query:'',count:0,snippets:[]};
  const started=Date.now(),content=await searchablePreviewText(row,stat);
  if(!content?.text)return {ok:true,active:true,query,count:0,snippets:[],truncated:false,source:'unavailable',elapsedMs:Date.now()-started};
  const extension=path.win32.extname(row.fullPath).replace(/^\./,'').toLowerCase();
  const matches=extension==='pdf'?buildContentMatchInfo(content.text,query,{contextChars:96,maxSnippets:500,maxMatches:500}):buildContentMatchInfo(content.text,query);
  await appendLog(`PREVIEW_MATCHES count=${matches.count} snippets=${matches.snippets.length} source=${content.source} elapsedMs=${Date.now()-started} path=${JSON.stringify(row.fullPath)}`);
  return {ok:true,active:true,...matches,truncated:!!content.truncated,source:content.source,elapsedMs:Date.now()-started};
}
function previewMetadata(row,stat){const extension=path.win32.extname(row.fullPath).replace(/^\./,'').toLowerCase();return {name:path.win32.basename(row.fullPath),path:path.win32.dirname(row.fullPath),fullPath:row.fullPath,extension,size:Number(stat.size)||0,isDirectory:stat.isDirectory(),modified:stat.mtime?.toISOString?.()||''}}
async function previewDocument(id){
  const {row,stat}=await resolveResult(id),meta=previewMetadata(row,stat);
  if(stat.isDirectory())return {ok:true,kind:'folder',...meta};
  const mime=BINARY_PREVIEW_MIME.get(meta.extension);
  if(mime&&stat.size<=BINARY_PREVIEW_MAX_BYTES)return {ok:true,kind:'binary',mime,source:'file',...meta};
  const officeKind=officePreviewKind(meta.extension),structuredKind=structuredPreviewKind(meta.extension);
  if(row.mode==='content'&&structuredKind&&stat.size<=STRUCTURED_PREVIEW_MAX_BYTES)return {ok:true,kind:'structured',documentKind:structuredKind,mime:STRUCTURED_PREVIEW_MIME.get(meta.extension)||'application/octet-stream',source:'local-renderer',...meta};
  if(TEXT_EXTENSIONS.has(meta.extension)){const data=await readTextPreview(row.fullPath,stat);return {ok:true,kind:'text',source:'file',...meta,...data}}
  if(row.mode==='content'&&officeKind){
    const indexed=await readEverythingContentPreview(row.fullPath);if(indexed)return {ok:true,kind:'text',source:'office-text-fallback',...meta,...indexed};
  }
  if(officeKind)return {ok:true,kind:'native',source:'windows-preview-handler',officeKind,...meta};
  const indexed=await readEverythingContentPreview(row.fullPath);
  if(indexed)return {ok:true,kind:'text',source:'everything-content',...meta,...indexed};
  if(mime||structuredKind)return {ok:true,kind:'unavailable',reason:'too-large',...meta};
  return {ok:true,kind:'unavailable',reason:'no-preview-handler',...meta};
}
async function readBinaryPreview(id){
  const {row,stat}=await resolveResult(id);if(stat.isDirectory()){const e=new Error('תיקייה אינה קובץ לתצוגה מקדימה.');e.code='PREVIEW_NOT_FILE';throw e}
  const extension=path.win32.extname(row.fullPath).replace(/^\./,'').toLowerCase();
  const mime=BINARY_PREVIEW_MIME.get(extension)||STRUCTURED_PREVIEW_MIME.get(extension);if(!mime){const e=new Error('סוג הקובץ אינו נתמך בתצוגה בינארית.');e.code='PREVIEW_UNSUPPORTED';throw e}
  const limit=STRUCTURED_PREVIEW_MIME.has(extension)?STRUCTURED_PREVIEW_MAX_BYTES:BINARY_PREVIEW_MAX_BYTES;
  if(stat.size>limit){const e=new Error('הקובץ גדול מדי לתצוגה מקדימה מהירה.');e.code='PREVIEW_TOO_LARGE';throw e}
  return {buffer:await fs.readFile(row.fullPath),mime,name:path.win32.basename(row.fullPath)};
}
function sendBinary(req,res,status,{buffer,mime,name},config){res.writeHead(status,{'Content-Type':mime,'Content-Length':String(buffer.length),'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(name)}`,...corsHeaders(req,config)});res.end(buffer)}

function tokenEqual(expected,actual){const a=Buffer.from(String(expected||'')),b=Buffer.from(String(actual||''));return a.length===b.length&&a.length>0&&timingSafeEqual(a,b)}
function authToken(req){const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():''}
function corsHeaders(req,config){const origin=String(req.headers.origin||'');return {'Access-Control-Allow-Origin':origin&&originAllowed(origin,config.allowedOrigins)?origin:'null','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Private-Network':'true','Access-Control-Max-Age':'600','Cache-Control':'no-store','Vary':'Origin'}}
function sendJson(req,res,status,data,config){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...corsHeaders(req,config)});res.end(JSON.stringify(data))}
async function readJson(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192){const e=new Error('הבקשה גדולה מדי');e.code='REQUEST_TOO_LARGE';throw e}chunks.push(chunk)}if(!chunks.length)return {};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{const e=new Error('JSON לא תקין');e.code='INVALID_JSON';throw e}}
function safeError(error){return {ok:false,code:error?.code||'DOCUMENT_BRIDGE_ERROR',message:error?.message||'שגיאת Document Bridge',rootErrors:Array.isArray(error?.rootErrors)?error.rootErrors:[]}}

async function openDocument(id){
  const {row,stat}=await resolveResult(id);
  if(process.platform!=='win32'){const e=new Error('פתיחת קובץ נתמכת רק ב-Windows.');e.code='WINDOWS_REQUIRED';throw e}
  const env={...process.env,NETUNIM_OPEN_TARGET:row.fullPath};
  // Use the Windows graphical shell for both folders and documents. Unlike
  // Shell.Application.Open, ProcessStartInfo+UseShellExecute invokes the
  // registered default "open" action for a directory/document in the user's
  // interactive shell and does not wait for explorer.exe to exit.
  const script='$p=$env:NETUNIM_OPEN_TARGET; $psi=New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName=$p; $psi.UseShellExecute=$true; [void][System.Diagnostics.Process]::Start($psi)';
  await execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:7000,env});
  await appendLog(`OPEN type=${stat.isDirectory()?'folder':'file'} shell=UseShellExecute path=${JSON.stringify(row.fullPath)}`);
  return {ok:true,type:stat.isDirectory()?'folder':'file'};
}

async function revealDocument(id){
  const {row,stat}=await resolveResult(id);
  if(process.platform!=='win32'){const e=new Error('פתיחת מיקום נתמכת רק ב-Windows.');e.code='WINDOWS_REQUIRED';throw e}
  const env={...process.env,NETUNIM_REVEAL_TARGET:row.fullPath};
  const script=`$p=$env:NETUNIM_REVEAL_TARGET; $psi=New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName='explorer.exe'; $psi.Arguments=('/select,"{0}"' -f $p); $psi.UseShellExecute=$true; [void][System.Diagnostics.Process]::Start($psi)`;
  await execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:7000,env});
  await appendLog(`REVEAL type=${stat.isDirectory()?'folder':'file'} shell=ExplorerSelect path=${JSON.stringify(row.fullPath)}`);
  return {ok:true,type:stat.isDirectory()?'folder':'file'};
}

function invalidateResultPath(fullPath){
  const target=String(fullPath||'').toLocaleLowerCase('en-US'),invalidatedIds=[];
  for(const [resultId,result] of requestResults){if(String(result.fullPath||'').toLocaleLowerCase('en-US')!==target)continue;requestResults.delete(resultId);invalidatedIds.push(resultId)}
  previewTextCache.delete(target);
  return invalidatedIds;
}

async function deleteDocument(id){
  const {row,stat}=await resolveResult(id);
  if(process.platform!=='win32'){const e=new Error('מחיקת קובץ נתמכת רק ב-Windows.');e.code='WINDOWS_REQUIRED';throw e}
  await hideNativePreview();
  const env={...process.env,NETUNIM_DELETE_TARGET:row.fullPath};
  const script='Add-Type -AssemblyName Microsoft.VisualBasic; $p=$env:NETUNIM_DELETE_TARGET; $ui=[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs; $recycle=[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin; $cancel=[Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException; if([System.IO.Directory]::Exists($p)){[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,$ui,$recycle,$cancel)}elseif([System.IO.File]::Exists($p)){[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,$ui,$recycle,$cancel)}else{throw "Target no longer exists."}';
  await execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:30000,env});
  let missing=false;try{await fs.stat(row.fullPath)}catch(error){if(error?.code==='ENOENT')missing=true;else throw error}if(!missing){const e=new Error('Windows לא אישר שהקובץ נמחק.');e.code='DELETE_TARGET_REMAINS';throw e}
  const invalidatedIds=invalidateResultPath(row.fullPath);
  await appendLog(`DELETE type=${stat.isDirectory()?'folder':'file'} recycle=SendToRecycleBin invalidated=${invalidatedIds.length} path=${JSON.stringify(row.fullPath)}`);
  return {ok:true,type:stat.isDirectory()?'folder':'file',invalidatedIds};
}

async function handle(req,res){
  const config=await loadConfig(),origin=String(req.headers.origin||'');
  if(origin&&!originAllowed(origin,config.allowedOrigins)){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'});res.end(JSON.stringify({ok:false,code:'ORIGIN_NOT_ALLOWED',message:'מקור האתר אינו מורשה לגשת ל-Document Bridge.'}));return}
  if(req.method==='OPTIONS'){res.writeHead(204,corsHeaders(req,config));res.end();return}
  if(req.method==='GET'&&req.url==='/health'){sendJson(req,res,200,{ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION},config);return}
  const expected=await ensureToken();if(!tokenEqual(expected,authToken(req))){sendJson(req,res,401,{ok:false,code:'UNAUTHORIZED',message:'מפתח Document Bridge שגוי או חסר.'},config);return}
  try{
    if(req.method==='GET'&&req.url==='/status'){
      const {probe,diagnostics}=await diagnoseIndex({freshProbe:true});
      sendJson(req,res,200,{ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,esVersion:probe.esVersion,everythingVersion:probe.everythingVersion,everythingExecutable:probe.everythingExecutable||'',instance:probe.instance,index:{fileCount:diagnostics.fileCount,indexedContentCount:diagnostics.indexedContentCount,sampleOk:diagnostics.sampleOk,error:diagnostics.error||''}},config);return;
    }
    if(req.method==='POST'&&req.url==='/documents/warm'){const probe=await probeEverything({autoStart:true});sendJson(req,res,200,{ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,everythingVersion:probe.everythingVersion,instance:probe.instance},config);return}
    if(req.method==='POST'&&req.url==='/documents/recent'){const body=await readJson(req),result=await recentDocuments(body.limit);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/search'){const body=await readJson(req),result=await searchDocuments(body.query,body.limit,body.mode);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/preview'){const body=await readJson(req),result=await previewDocument(body.id);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/matches'){const body=await readJson(req),result=await previewMatches(body.id);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/preview-file'){const body=await readJson(req),result=await readBinaryPreview(body.id);sendBinary(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/native-preview'){const body=await readJson(req),result=await openNativePreview(body.id,body.geometry);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/native-preview/move'){const body=await readJson(req),result=await moveNativePreview(body.geometry);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/native-preview/hide'){const result=await hideNativePreview();sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/open'){const body=await readJson(req),result=await openDocument(body.id);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/reveal'){const body=await readJson(req),result=await revealDocument(body.id);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/delete'){const body=await readJson(req),result=await deleteDocument(body.id);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/shutdown'){await stopNativePreview();sendJson(req,res,200,{ok:true},config);setTimeout(()=>{server?.close(async()=>{await appendLog('STOP graceful shutdown complete')})},20);return}
    sendJson(req,res,404,{ok:false,code:'NOT_FOUND',message:'נתיב לא קיים'},config);
  }catch(error){await appendLog(`${req.method} ${req.url} ${error?.code||'ERROR'} ${error?.message||error}`);const status=error?.code==='QUERY_TOO_SHORT'?400:error?.code==='RESULT_EXPIRED'?410:503;sendJson(req,res,status,safeError(error),config)}
}

function loopbackRequest(urlPath,{method='GET',token='',timeoutMs=2500}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:BRIDGE_PORT,path:urlPath,method,headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},agent:false},res=>{
      let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size<=65536)chunks.push(chunk)});res.on('end',()=>{let data={};try{data=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{}resolve({statusCode:Number(res.statusCode)||0,data})});
    });
    req.setTimeout(timeoutMs,()=>req.destroy(Object.assign(new Error('Loopback request timed out'),{code:'ETIMEDOUT'})));req.on('error',reject);req.end();
  });
}
async function checkRunning(){const response=await loopbackRequest('/health',{timeoutMs:2500});if(response.statusCode!==200||response.data?.service!==BRIDGE_SERVICE||Number(response.data?.version)!==BRIDGE_VERSION){const e=new Error('Document Bridge health check failed.');e.code='HEALTHCHECK_FAILED';throw e}return response.data}
async function stopExisting(){
  let health;try{health=await loopbackRequest('/health',{timeoutMs:900})}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code)))return;throw error}
  if(health.statusCode!==200||health.data?.service!==BRIDGE_SERVICE){const e=new Error(`Port ${BRIDGE_PORT} is already in use by another service.`);e.code='PORT_IN_USE';throw e}
  let token='';try{token=(await fs.readFile(TOKEN_PATH,'utf8')).trim()}catch{}if(!token){const e=new Error('Existing Document Bridge is running but its local token is unavailable.');e.code='TOKEN_MISSING';throw e}
  const response=await loopbackRequest('/shutdown',{method:'POST',token,timeoutMs:2500});if(response.statusCode!==200){const e=new Error(`Existing Document Bridge refused shutdown (HTTP ${response.statusCode}).`);e.code='SHUTDOWN_FAILED';throw e}
  const deadline=Date.now()+3500;while(Date.now()<deadline){await new Promise(r=>setTimeout(r,120));try{await loopbackRequest('/health',{timeoutMs:300})}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code)))return}}
  const e=new Error('Existing Document Bridge did not stop in time.');e.code='SHUTDOWN_TIMEOUT';throw e;
}

async function printDoctor(){
  await init();const {probe,diagnostics}=await diagnoseIndex({freshProbe:true});
  const executable=probe.everythingExecutable||await findEverythingExecutable(await loadConfig());
  console.log(`Document Bridge v${BRIDGE_VERSION}`);console.log(`Node: ${process.versions.node}`);console.log(`ES: ${probe.esVersion||'unknown'} (${probe.esPath})`);console.log(`Everything: ${probe.everythingVersion||'unknown'}${probe.instance?` [instance ${probe.instance}]`:''}`);console.log(`Everything background executable: ${executable}`);console.log(`Windows Preview Handler host: ${(await existsFile(NATIVE_PREVIEW_HOST))?'OK':'MISSING'}`);console.log('Search scope: complete Everything index (same database as Everything UI)');
  console.log(`Files visible in Everything: ${diagnostics.fileCount===null?'ERROR':diagnostics.fileCount}`);console.log(`Files with indexed content: ${diagnostics.indexedContentCount===null?'ERROR':diagnostics.indexedContentCount}`);console.log(`ES UTF-8 JSON parsing: ${diagnostics.fileCount>0?(diagnostics.sampleOk?'OK':'FAILED'):'not tested'}`);if(diagnostics.error)console.log(`ES error: ${diagnostics.error}`);
  if(diagnostics.error||(diagnostics.fileCount>0&&!diagnostics.sampleOk)){const e=new Error('Everything/ES diagnostics failed.');e.code='INDEX_DIAGNOSTICS_FAILED';throw e}
  if(diagnostics.fileCount===0)console.log('WARNING: Everything currently sees no files. The website will mirror that empty Everything index.');
}
async function writeInstallSummary(){
  const token=await ensureToken(),config=await loadConfig();let probe=null,diagnostics={fileCount:null,indexedContentCount:null,sampleOk:false,error:''},everythingExecutable='';
  try{const data=await diagnoseIndex({freshProbe:true});probe=data.probe;diagnostics=data.diagnostics;everythingExecutable=probe.everythingExecutable||await findEverythingExecutable(config)}catch{}
  const lines=['NETUNIM DOCUMENT BRIDGE - INSTALLATION LOG','==========================================','','הקוד שצריך להדביק באתר:',token,'','באתר: Ctrl+K -> קבצים במחשב -> הדבק את הקוד שלמעלה פעם אחת.','',`Bridge version: ${BRIDGE_VERSION}`,`Node version: ${process.versions.node}`,`Local address: http://127.0.0.1:${BRIDGE_PORT}`,probe?`Everything: ${probe.everythingVersion||'unknown'}`:'Everything: status unavailable',`Everything background executable: ${everythingExecutable||'(not found)'}`,`Windows Preview Handler host: ${await existsFile(NATIVE_PREVIEW_HOST)?'OK':'MISSING'}`,'','Search scope: COMPLETE EVERYTHING INDEX','The Bridge no longer maintains a separate folder allowlist. Whatever Everything indexes is searchable from the website.','','בדיקת האינדקס:',`   files visible in Everything: ${diagnostics.fileCount??'ERROR'}`,`   files with indexed content: ${diagnostics.indexedContentCount??'ERROR'}`,`   ES UTF-8 JSON parsing: ${diagnostics.fileCount>0?(diagnostics.sampleOk?'OK':'FAILED'):'not tested'}`,...(diagnostics.error?[`   error: ${diagnostics.error}`]:[]),'',`Runtime log: ${LOG_PATH}`,`Console log: ${path.join(APP_ROOT,'bridge-console.log')}`,`ES installer log: ${path.join(APP_ROOT,'install-es.log')}`,'','ES is forced to UTF-8 output (-cp 65001) and Unicode argv parsing (-argv).','Search text is passed after -- to preserve Everything quotes; -max-results limits only the IPC viewport.','Everything.exe is started automatically in background mode (-startup) when needed. No search window is opened.','Searches use the same Everything index/database as the Everything UI.','Office previews use the Windows system IPreviewHandler associated with the file extension (the same preview layer Everything normally uses).','Files and extracted content stay on this computer and are not uploaded to the website or Supabase.'];
  await fs.writeFile(SUMMARY_PATH,lines.join('\r\n')+'\r\n','utf8');console.log(SUMMARY_PATH);
}

async function main(){
  const arg=process.argv[2]||'';
  if(arg==='--init'){await init();return}if(arg==='--doctor'){await printDoctor();return}if(arg==='--ensure-everything'){await init();const probe=await probeEverything({fresh:true,autoStart:true});console.log(`${probe.everythingVersion||'unknown'} ${probe.everythingExecutable||''}`.trim());return}if(arg==='--print-token'){console.log(await ensureToken());return}if(arg==='--stop-existing'){await stopExisting();return}if(arg==='--check-running'){await checkRunning();return}if(arg==='--write-install-summary'){await writeInstallSummary();return}
  if(process.platform!=='win32')throw new Error('Document Bridge is intended for Windows.');
  await init();server=http.createServer((req,res)=>{handle(req,res).catch(async error=>{await appendLog(`UNHANDLED ${error?.stack||error}`);try{res.writeHead(500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(safeError(error)))}catch{}})});server.on('error',error=>appendLog(`SERVER ${error?.code||''} ${error?.message||error}`));server.listen(BRIDGE_PORT,'127.0.0.1',()=>{appendLog(`START ${BRIDGE_SERVICE} v${BRIDGE_VERSION} node=${process.versions.node} on 127.0.0.1:${BRIDGE_PORT}`);probeEverything({fresh:true,autoStart:true}).then(probe=>appendLog(`EVERYTHING_READY version=${probe.everythingVersion} instance=${probe.instance||'(default)'}`)).catch(error=>appendLog(`EVERYTHING_BACKGROUND_START_FAILED ${error?.code||'ERROR'} ${error?.message||error}`))});
}
main().catch(async error=>{await appendLog(`FATAL ${error?.stack||error}`);console.error(error?.message||error);process.exitCode=1});
