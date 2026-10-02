import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto,{timingSafeEqual} from 'node:crypto';
import {execFile as execFileCb,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {
  BRIDGE_PORT,BRIDGE_SERVICE,BRIDGE_VERSION,BRIDGE_NODE_VERSION,BRIDGE_NODE_WIN_X64_SHA256,assertBridgeNodeVersion,DEFAULT_ALLOWED_ORIGINS,DEFAULT_RESULT_LIMIT,MAX_RESULTS,RECENT_RESULT_LIMIT,RESULT_TTL_MS,
  buildContentMatchInfo,buildDocumentQuery,buildEsContentPreviewArgs,buildEsCountArgs,buildEsPdfInventoryArgs,buildEsRawSearchArgs,buildEsRecentFilesArgs,buildEsSearchArgs,compareDocumentRows,contentSearchMatches,documentExtension,documentFileTypeIncludesPdf,mergeDocumentResults,normalizeContentSearchOptions,normalizeDocumentFileType,normalizeDocumentSearchMode,normalizeDocumentSort,normalizeSearchScopePath,normalizeSearchText,
  officePreviewKind,structuredPreviewKind,originAllowed,parseEsContentPreview,parseEsCount,parseEsJson,parseRegistryInstallLocation,
} from './lib.mjs';
import {buildPdfFormMatchAnchors,extractInteractivePdfText,PDF_FORM_MAX_BYTES,verifyNodePdfJsRuntime} from './pdf_form_index.mjs';
import {pdfIndexNeedsInspection,pdfMaintenanceInventoryPlan} from './pdf-index-policy.mjs';

const execFile=promisify(execFileCb);
const APP_ROOT=process.env.NETUNIM_DOCUMENT_BRIDGE_HOME||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'NetunimDocumentBridge');
const RUNTIME_ROOT=fileURLToPath(new URL('.',import.meta.url));
const CONFIG_PATH=path.join(APP_ROOT,'config.json');
const TOKEN_PATH=path.join(APP_ROOT,'bridge-token.txt');
const LOG_PATH=path.join(APP_ROOT,'bridge.log');
const SUMMARY_PATH=path.join(APP_ROOT,'INSTALLATION-LOG.txt');
const NODE_RUNTIME_POINTER_PATH=path.join(APP_ROOT,'node-runtime.txt');
const PDF_MAINTENANCE_TASK_NAME='NetunimDocumentBridgePdfMaintenance';
const PDF_FORM_INDEX_PATH=path.join(APP_ROOT,'pdf-form-index.json');
const PDF_FORM_INDEX_JOURNAL_PATH=path.join(APP_ROOT,'pdf-form-index.journal.jsonl');
const TOOL_ES=path.join(APP_ROOT,'tools','es.exe');
const NATIVE_PREVIEW_HOST=path.join(RUNTIME_ROOT,'NetunimPreviewHost.exe');
const requestResults=new Map();
const previewTextCache=new Map();
const TEXT_PREVIEW_MAX_BYTES=1024*1024;
const BINARY_PREVIEW_MAX_BYTES=64*1024*1024;
const STRUCTURED_PREVIEW_MAX_BYTES=64*1024*1024;
const TEXT_PREVIEW_MAX_CHARS=600000;
const PREVIEW_TEXT_CACHE_TTL_MS=10*60*1000;
const PREVIEW_TEXT_CACHE_MAX=24;
const PDF_FORM_INDEX_SCHEMA=3;
const PDF_FORM_INDEX_LEGACY_SCHEMAS=new Set([1,2,PDF_FORM_INDEX_SCHEMA]);
const PDF_FORM_DETECTION_REVISION=2;
const PDF_FORM_SEARCH_TEXT_REVISION=2;
const PDF_FORM_GEOMETRY_REVISION=1;
const PDF_FORM_INDEX_PAGE_SIZE=250;
const PDF_FORM_MAINTENANCE_INTERVAL_MS=20*60*60*1000;
const PDF_FORM_RECONCILE_INTERVAL_MS=PDF_FORM_MAINTENANCE_INTERVAL_MS;
const PDF_FORM_RETRY_MS=24*60*60*1000;
const PDF_FORM_MAINTENANCE_MAX_FILES=300;
const PDF_FORM_MAINTENANCE_MAX_MS=15*60*1000;
const PDF_FORM_MAINTENANCE_PATH=path.join(APP_ROOT,'pdf-form-maintenance.json');
const PDF_FORM_INDEX_LOCK_PATH=path.join(APP_ROOT,'pdf-form-index.lock');
const PDF_FORM_MAINTENANCE_LOCK_PATH=path.join(APP_ROOT,'pdf-form-maintenance.lock');
const TEXT_EXTENSIONS=new Set(['txt','log','md','markdown','csv','tsv','json','xml','yaml','yml','ini','cfg','conf','sql','js','mjs','cjs','ts','tsx','jsx','css','scss','less','html','htm']);
const BINARY_PREVIEW_MIME=new Map([['pdf','application/pdf'],['png','image/png'],['jpg','image/jpeg'],['jpeg','image/jpeg'],['gif','image/gif'],['webp','image/webp'],['bmp','image/bmp'],['svg','image/svg+xml']]);
const STRUCTURED_PREVIEW_MIME=new Map([['docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['docm','application/vnd.ms-word.document.macroEnabled.12'],['dotx','application/vnd.openxmlformats-officedocument.wordprocessingml.template'],['dotm','application/vnd.ms-word.template.macroEnabled.12'],['xls','application/vnd.ms-excel'],['xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['xlsm','application/vnd.ms-excel.sheet.macroEnabled.12'],['xlsb','application/vnd.ms-excel.sheet.binary.macroEnabled.12'],['xlt','application/vnd.ms-excel'],['xltx','application/vnd.openxmlformats-officedocument.spreadsheetml.template'],['xltm','application/vnd.ms-excel.template.macroEnabled.12']]);
let server=null,cachedProbe=null,cachedEsPath='',everythingProbePromise=null,everythingStartPromise=null,nativePreviewProcess=null,nativePreviewBuffer='',nativePreviewSequence=0;
let pdfFormIndexLoaded=false,pdfFormIndexRefreshPromise=null,pdfFormIndexRefreshAbortController=null,pdfFormIndexLastRefresh=0,pdfFormIndexPending=0,pdfFormIndexInventoryCount=0,shuttingDown=false,pdfFormIndexSignature='';
let manualPdfMaintenanceChild=null,manualPdfMaintenance=null,manualPdfMaintenanceStartPromise=null,pdfMaintenanceStopRequested=false;
let pdfFormIndexBacklog=[];
const pdfFormIndex=new Map();
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

const PRIVATE_NODE_RUNTIME_PATTERN=/^node-v24\.21\.0-win-x64-[0-9]{8}-[0-9]{6}-[0-9]+-[0-9a-f]{8}$/i;
function normalizedRuntimePath(value){return path.resolve(String(value||'')).replace(/[\\/]+$/,'').toLocaleLowerCase('en-US')}
function privateNodeRuntimeInfoSync({verifyHash=false}={}){
  assertBridgeNodeVersion(process.versions.node);
  if(process.platform!=='win32')return {runtimeName:'',expectedPath:process.execPath,actualPath:process.execPath,sha256:'',verified:true};
  let runtimeName='';try{runtimeName=fsSync.readFileSync(NODE_RUNTIME_POINTER_PATH,'utf8').replace(/^\uFEFF/,'').trim()}catch(error){const e=new Error('Private Node runtime pointer is missing. Reinstall Document Bridge.');e.code='NODE_RUNTIME_POINTER_MISSING';e.cause=error;throw e}
  if(!PRIVATE_NODE_RUNTIME_PATTERN.test(runtimeName)){const e=new Error(`Private Node runtime pointer is invalid: ${runtimeName||'(empty)'}.`);e.code='NODE_RUNTIME_POINTER_INVALID';throw e}
  const expectedPath=path.join(APP_ROOT,runtimeName,'node.exe'),actualPath=process.execPath;
  if(!fsSync.existsSync(expectedPath)){const e=new Error(`Pinned private Node runtime is missing: ${expectedPath}`);e.code='NODE_RUNTIME_MISSING';throw e}
  if(normalizedRuntimePath(expectedPath)!==normalizedRuntimePath(actualPath)){const e=new Error(`Document Bridge must run with its pinned private Node runtime. Expected ${expectedPath}; found ${actualPath}.`);e.code='NODE_RUNTIME_NOT_PRIVATE';throw e}
  let sha256='';if(verifyHash){sha256=crypto.createHash('sha256').update(fsSync.readFileSync(actualPath)).digest('hex');if(sha256!==BRIDGE_NODE_WIN_X64_SHA256){const e=new Error(`Pinned private Node runtime failed SHA-256 verification: ${sha256}.`);e.code='NODE_RUNTIME_INTEGRITY_MISMATCH';throw e}}
  return {runtimeName,expectedPath,actualPath,sha256,verified:!verifyHash||sha256===BRIDGE_NODE_WIN_X64_SHA256};
}

async function whereEs(){
  if(cachedEsPath)return cachedEsPath;
  const candidates=[process.env.NETUNIM_EVERYTHING_ES_PATH,TOOL_ES,path.join(process.env.LOCALAPPDATA||'','Microsoft','WindowsApps','es.exe'),path.join(process.env.PROGRAMFILES||'C:\\Program Files','Everything','es.exe'),path.join(process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)','Everything','es.exe')].filter(Boolean);
  for(const candidate of candidates)if(await existsFile(candidate)){cachedEsPath=candidate;return cachedEsPath}
  if(process.platform==='win32')try{const {stdout}=await execFile('where.exe',['es.exe'],{encoding:'utf8',windowsHide:true,timeout:3000});const candidate=stdout.split(/\r?\n/).map(x=>x.trim()).find(Boolean);if(candidate){cachedEsPath=candidate;return cachedEsPath}}catch{}
  const e=new Error('es.exe לא נמצא. יש להריץ מחדש את מתקין Document Bridge.');e.code='ES_NOT_FOUND';throw e;
}
function instanceArgs(instance){return instance?['-instance',instance]:[]}
async function runEs(esPath,args,{timeout=18000,signal=null}={}){
  try{return await execFile(esPath,args,{encoding:'utf8',windowsHide:true,timeout,maxBuffer:16*1024*1024,cwd:APP_ROOT,...(signal?{signal}:{})})}
  catch(error){if(error?.name==='AbortError'||String(error?.code||'')==='ABORT_ERR')throw error;const e=new Error(String(error?.stderr||error?.message||'ES failed').trim()||'ES failed');e.code=`ES_EXIT_${Number.isFinite(Number(error?.code))?Number(error.code):'ERROR'}`;e.exitCode=Number(error?.code);e.stderr=String(error?.stderr||'');throw e}
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
    const child=spawn(executable,args,{detached:true,windowsHide:true,stdio:'ignore',cwd:APP_ROOT});child.unref();
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
function publicResult(row,{query='',mode='everything',contentSearch={}}={}){const id=crypto.randomUUID();requestResults.set(id,{fullPath:row.fullPath,name:row.name,relativePath:row.relativePath,modified:row.modified,size:row.size,attributes:row.attributes||'',query:String(query||''),mode:normalizeDocumentSearchMode(mode),contentSearch:normalizeContentSearchOptions(contentSearch),expiresAt:Date.now()+RESULT_TTL_MS});return {id,name:row.name,relativePath:row.relativePath,modified:row.modified,size:row.size,extension:row.extension,attributes:row.attributes||'',isDirectory:!!row.isDirectory,rootId:'everything',rootLabel:'Everything'}}
async function runEverythingJson(buildArgs,{signal=null}={}){
  const config=await loadConfig();let probe=await probeEverything({autoStart:true});const started=Date.now();
  const runSearch=currentProbe=>runEs(currentProbe.esPath,buildArgs(config,currentProbe),{timeout:config.searchTimeoutMs+5000,signal});
  let output;
  try{output=await runSearch(probe)}catch(error){
    if(error?.exitCode!==8)throw error;
    cachedProbe=null;probe=await probeEverything({fresh:true,autoStart:true});output=await runSearch(probe);
  }
  return {rows:parseEsJson(output.stdout),elapsedMs:Date.now()-started};
}

function pdfIndexKey(fullPath){return String(fullPath||'').toLocaleLowerCase('en-US')}
function pdfIndexFingerprint(row){return `${Number(row.size)||0}:${String(row.modified||'')}`}
function pdfIndexInScope(fullPath,scopePath){
  if(!scopePath)return true;
  const relative=path.win32.relative(scopePath,fullPath);
  return relative===''||(!relative.startsWith('..\\')&&relative!=='..'&&!path.win32.isAbsolute(relative));
}
function normalizePdfFormField(field){
  const rect=Array.isArray(field?.rect)&&field.rect.length===4?field.rect.map(Number):null,values=Array.isArray(field?.values)?field.values.map(value=>String(value||'')).filter(Boolean):[];
  if(!rect||!rect.every(Number.isFinite)||!values.length)return null;
  const pageNumber=Math.max(1,Number(field?.pageNumber)||1),annotationIndex=Math.max(0,Number(field?.annotationIndex)||0),fieldName=String(field?.fieldName||''),fieldKey=String(field?.fieldKey||'')||`field:${pageNumber}:${annotationIndex}:${fieldName}:${rect.join(',')}`;
  return {pageNumber,annotationIndex,fieldKey,fieldName,fieldType:String(field?.fieldType||''),rect,values,multiLine:!!field?.multiLine};
}
function normalizePdfFormFields(fields){return (Array.isArray(fields)?fields:[]).map(normalizePdfFormField).filter(Boolean)}
function normalizePdfIndexEntry(entry){
  const fullPath=String(entry?.fullPath||'');if(!fullPath)return null;
  const hasForm=typeof entry.hasForm==='boolean'?entry.hasForm:(Math.max(0,Number(entry.formFieldCount)||0)>0||!!String(entry.text||'')),formFields=normalizePdfFormFields(entry.formFields);
  const legacyRevision=Math.max(0,Number(entry.extractorRevision)||0);
  return {fullPath,name:String(entry.name||path.win32.basename(fullPath)),relativePath:String(entry.relativePath||path.win32.dirname(fullPath)),modified:String(entry.modified||''),size:Number.isFinite(Number(entry.size))?Number(entry.size):null,fileMtimeMs:Number(entry.fileMtimeMs)||0,extension:'pdf',attributes:String(entry.attributes||''),isDirectory:false,rootId:'everything',rootLabel:'Everything',fingerprint:String(entry.fingerprint||''),detectionRevision:Math.max(0,Number(entry.detectionRevision)||legacyRevision),searchTextRevision:Math.max(0,Number(entry.searchTextRevision)||legacyRevision),geometryRevision:Math.max(0,Number(entry.geometryRevision)||((hasForm&&formFields.length)?legacyRevision:0)),hasForm,text:String(entry.text||''),formFields,formFieldCount:Math.max(formFields.length,Math.max(0,Number(entry.formFieldCount)||0)),failed:!!entry.failed,error:String(entry.error||''),retryAfter:String(entry.retryAfter||''),retryCount:Math.max(0,Number(entry.retryCount)||0)};
}
function serializePdfIndexEntry(entry){return {fullPath:entry.fullPath,name:entry.name,relativePath:entry.relativePath,modified:entry.modified,size:entry.size,fileMtimeMs:entry.fileMtimeMs||0,attributes:entry.attributes||'',fingerprint:entry.fingerprint,detectionRevision:Math.max(0,Number(entry.detectionRevision)||0),searchTextRevision:Math.max(0,Number(entry.searchTextRevision)||0),geometryRevision:Math.max(0,Number(entry.geometryRevision)||0),hasForm:!!entry.hasForm,text:entry.text||'',formFields:normalizePdfFormFields(entry.formFields),formFieldCount:entry.formFieldCount||0,failed:!!entry.failed,error:entry.error||'',retryAfter:entry.retryAfter||'',retryCount:entry.retryCount||0}}
async function withFileLock(lockPath,task,{waitMs=10000,staleMs=10*60*1000}={}){
  await ensureRoot();const deadline=Date.now()+waitMs,ownerPath=path.join(lockPath,'owner.json');
  while(true){
    try{await fs.mkdir(lockPath)}catch(error){
      if(error?.code!=='EEXIST')throw error;
      const stat=await fs.stat(lockPath).catch(()=>null);
      const owner=await readJsonFile(ownerPath,null),pid=Number(owner?.pid);
      let ownerAlive=false;
      if(Number.isInteger(pid)&&pid>0)try{process.kill(pid,0);ownerAlive=true}catch(checkError){ownerAlive=checkError?.code==='EPERM'}
      if(stat&&((owner&&!ownerAlive)||(Date.now()-stat.mtimeMs>staleMs)||(!owner&&Date.now()-stat.mtimeMs>30000))){
        await fs.unlink(ownerPath).catch(()=>{});
        const removed=await fs.rmdir(lockPath).then(()=>true).catch(()=>false);
        if(removed)continue;
      }
      if(Date.now()>=deadline)throw new Error(`Timed out waiting for ${path.basename(lockPath)}`);
      await new Promise(resolve=>setTimeout(resolve,80));
      continue;
    }
    try{await fs.writeFile(ownerPath,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),'utf8')}catch(error){await fs.rmdir(lockPath).catch(()=>{});throw error}
    break;
  }
  try{return await task()}finally{await fs.unlink(ownerPath).catch(()=>{});await fs.rmdir(lockPath).catch(()=>{})}
}
async function activePdfMaintenanceLock(){
  const stat=await fs.stat(PDF_FORM_MAINTENANCE_LOCK_PATH).catch(()=>null);
  if(!stat)return false;
  const owner=await readJsonFile(path.join(PDF_FORM_MAINTENANCE_LOCK_PATH,'owner.json'),null),pid=Number(owner?.pid);
  if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);return true}catch(error){return error?.code==='EPERM'}}
  return !owner&&Date.now()-stat.mtimeMs<30000;
}
async function sendMaintenanceIpc(message){
  if(!process.send||!process.connected)return;
  await new Promise(resolve=>process.send(message,()=>resolve()));
}
async function pdfMaintenanceStatus(){
  const maintenance=await readJsonFile(PDF_FORM_MAINTENANCE_PATH,{});
  const manual=manualPdfMaintenance,running=!!manual?.running||await activePdfMaintenanceLock();
  return {ok:true,bridgeVersion:BRIDGE_VERSION,running,source:manual?.running?'manual':running?'scheduled':'',cancelable:!!manual?.running&&!manual.stopRequested&&!!manualPdfMaintenanceChild?.connected,stopRequested:!!manual?.running&&!!manual.stopRequested,phase:manual?.running?manual.phase||'starting':'',progress:manual?.running?manual.progress||null:null,lastRun:!manual?.running?manual?.result||null:null,lastError:!manual?.running?manual?.error||'':'',lastResult:maintenance.lastResult||null,lastFailure:maintenance.lastFailure||''};
}
async function startManualPdfMaintenance(){
  if(manualPdfMaintenanceStartPromise)return manualPdfMaintenanceStartPromise;
  const task=(async()=>{
    if(manualPdfMaintenance?.running||await activePdfMaintenanceLock())return pdfMaintenanceStatus();
    const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--refresh-pdf-index','--force'],{cwd:APP_ROOT,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
    const run={running:true,stopRequested:false,phase:'starting',progress:null,result:null,error:'',startedAt:new Date().toISOString()};
    manualPdfMaintenanceChild=child;manualPdfMaintenance=run;
    child.on('message',message=>{
      if(manualPdfMaintenance!==run||!message||typeof message!=='object')return;
      if(message.type==='pdf-maintenance-progress'){run.phase=message.progress?.phase||'scan';run.progress=message.progress||null}
      if(message.type==='pdf-maintenance-result'){run.result=message.result||null;run.phase=run.result?.aborted?'stopped':'finished'}
    });
    child.on('error',error=>{run.error=String(error?.message||error)});
    child.on('exit',(code,signal)=>{
      run.running=false;run.finishedAt=new Date().toISOString();
      if(code!==0&&!run.error)run.error=`עדכון אינדקס PDF נכשל (${signal||code}).`;
      if(run.stopRequested&&!run.error)run.phase='stopped';
      if(manualPdfMaintenanceChild===child)manualPdfMaintenanceChild=null;
    });
    await appendLog(`PDF_FORM_INDEX_MANUAL_START pid=${child.pid||0}`);
    return pdfMaintenanceStatus();
  })();
  manualPdfMaintenanceStartPromise=task;
  try{return await task}finally{if(manualPdfMaintenanceStartPromise===task)manualPdfMaintenanceStartPromise=null}
}
async function stopManualPdfMaintenance(){
  const child=manualPdfMaintenanceChild,run=manualPdfMaintenance;
  if(!run?.running||!child?.connected)return pdfMaintenanceStatus();
  if(!run.stopRequested){
    await new Promise((resolve,reject)=>child.send({type:'stop-pdf-maintenance'},error=>error?reject(error):resolve()));
    run.stopRequested=true;run.phase='stopping';
    await appendLog(`PDF_FORM_INDEX_MANUAL_STOP_REQUESTED pid=${child.pid||0}`);
  }
  return pdfMaintenanceStatus();
}
async function pdfIndexSignature(){
  const stats=await Promise.all([PDF_FORM_INDEX_PATH,PDF_FORM_INDEX_JOURNAL_PATH].map(file=>fs.stat(file).catch(()=>null)));
  return stats.map(stat=>stat?`${stat.size}:${stat.mtimeMs}`:'missing').join('|');
}
async function readPdfIndexFiles(){
  const stored=await readJsonFile(PDF_FORM_INDEX_PATH,null);
  if(await existsFile(PDF_FORM_INDEX_PATH)&&(!stored||!PDF_FORM_INDEX_LEGACY_SCHEMAS.has(Number(stored.schema))||!Array.isArray(stored.entries)))throw new Error('PDF index snapshot is invalid or newer than this Bridge; leaving it untouched');
  pdfFormIndex.clear();
  if(PDF_FORM_INDEX_LEGACY_SCHEMAS.has(Number(stored?.schema))&&Array.isArray(stored.entries))for(const raw of stored.entries){const entry=normalizePdfIndexEntry(raw);if(entry)pdfFormIndex.set(pdfIndexKey(entry.fullPath),entry)}
  let journal='';try{journal=await fs.readFile(PDF_FORM_INDEX_JOURNAL_PATH,'utf8')}catch{}
  if(journal)for(const line of journal.split(/\r?\n/)){if(!line.trim())continue;try{const record=JSON.parse(line);if(record?.op==='remove'){pdfFormIndex.delete(pdfIndexKey(record.fullPath));continue}if(record?.op==='upsert'){const entry=normalizePdfIndexEntry(record.entry);if(entry)pdfFormIndex.set(pdfIndexKey(entry.fullPath),entry)}}catch{}}
  pdfFormIndexPending=Math.max(0,Number(stored?.pending)||0);pdfFormIndexInventoryCount=Math.max(0,Number(stored?.pdfCount)||0);
  const storedUpdated=Date.parse(String(stored?.updatedAt||''));pdfFormIndexLastRefresh=Number.isFinite(storedUpdated)?storedUpdated:0;
  pdfFormIndexLoaded=true;pdfFormIndexSignature=await pdfIndexSignature();
}
async function loadPdfFormIndex(){
  if(pdfFormIndexLoaded&&pdfFormIndexSignature===await pdfIndexSignature())return;
  await withFileLock(PDF_FORM_INDEX_LOCK_PATH,async()=>{if(!pdfFormIndexLoaded||pdfFormIndexSignature!==await pdfIndexSignature())await readPdfIndexFiles()});
}
async function appendPdfIndexJournal(records){
  if(!records.length)return;
  await withFileLock(PDF_FORM_INDEX_LOCK_PATH,async()=>{await fs.appendFile(PDF_FORM_INDEX_JOURNAL_PATH,records.map(record=>JSON.stringify(record)).join('\n')+'\n','utf8')});
}
async function compactPdfFormIndex({pending=pdfFormIndexPending,pdfCount=pdfFormIndexInventoryCount}={}){
  await withFileLock(PDF_FORM_INDEX_LOCK_PATH,async()=>{
    await readPdfIndexFiles();pdfFormIndexPending=Math.max(0,Number(pending)||0);pdfFormIndexInventoryCount=Math.max(0,Number(pdfCount)||0);
    const entries=[...pdfFormIndex.values()].map(serializePdfIndexEntry);
    await writeJsonFile(PDF_FORM_INDEX_PATH,{schema:PDF_FORM_INDEX_SCHEMA,updatedAt:new Date().toISOString(),pdfCount:pdfFormIndexInventoryCount,pending:pdfFormIndexPending,entries});
    await fs.writeFile(PDF_FORM_INDEX_JOURNAL_PATH,'','utf8');pdfFormIndexLastRefresh=Date.now();pdfFormIndexSignature=await pdfIndexSignature();
  });
}
async function listEverythingPdfs({signal=null,modifiedSince='',verifyComplete=false}={}){
  const rows=[];let offset=0,expected=null,probe=null,config=null;
  if(verifyComplete){config=await loadConfig();probe=await probeEverything({autoStart:true});expected=await countIndex(probe,config,'ext:pdf')}
  while(true){
    if(shuttingDown||signal?.aborted)throw new Error('PDF inventory interrupted');
    const page=await runEverythingJson((config,probe)=>buildEsPdfInventoryArgs({limit:PDF_FORM_INDEX_PAGE_SIZE,offset,timeoutMs:config.searchTimeoutMs,instance:probe.instance,modifiedSince}),{signal});
    rows.push(...page.rows.filter(row=>row.extension==='pdf'&&!row.isDirectory));
    if(page.rows.length<PDF_FORM_INDEX_PAGE_SIZE)break;
    offset+=page.rows.length;
  }
  if(verifyComplete){
    const finalCount=await countIndex(probe,config,'ext:pdf'),unique=new Set(rows.map(row=>pdfIndexKey(row.fullPath))).size;
    if(expected!==finalCount||unique!==finalCount)throw new Error(`PDF inventory changed during paging (before=${expected}, after=${finalCount}, unique=${unique}); reconciliation deferred`);
  }
  return rows;
}
function isAbortError(error){return error?.name==='AbortError'||String(error?.code||'')==='ABORT_ERR'}
async function rebuildPdfFormIndexBacklog({signal=null,full=false,modifiedSince=''}={}){
  const rows=await listEverythingPdfs({signal,modifiedSince:full?'':modifiedSince,verifyComplete:full});
  const seen=new Set(),changed=[];let removed=0;
  for(const row of rows){
    const key=pdfIndexKey(row.fullPath),fingerprint=pdfIndexFingerprint(row);seen.add(key);
    const existing=pdfFormIndex.get(key);if(!pdfIndexNeedsInspection(existing,fingerprint,Date.now(),{detectionRevision:PDF_FORM_DETECTION_REVISION,searchTextRevision:PDF_FORM_SEARCH_TEXT_REVISION}))continue;
    changed.push({...row,fingerprint});
  }
  if(!full)for(const entry of pdfFormIndex.values())if(entry.failed&&!seen.has(pdfIndexKey(entry.fullPath))&&pdfIndexNeedsInspection(entry,entry.fingerprint,Date.now(),{detectionRevision:PDF_FORM_DETECTION_REVISION,searchTextRevision:PDF_FORM_SEARCH_TEXT_REVISION}))changed.push({...entry});
  changed.sort((a,b)=>(Date.parse(b.modified)||0)-(Date.parse(a.modified)||0)||a.fullPath.localeCompare(b.fullPath));
  const removalRecords=[];
  if(full){
    if(pdfFormIndex.size>100&&rows.length<pdfFormIndex.size/2)throw new Error(`PDF inventory unexpectedly shrank from ${pdfFormIndex.size} to ${rows.length}; keeping cached entries`);
    for(const [key,entry] of [...pdfFormIndex.entries()])if(!seen.has(key)){pdfFormIndex.delete(key);removalRecords.push({op:'remove',fullPath:entry.fullPath});removed+=1}
  }
  pdfFormIndexBacklog=changed;pdfFormIndexPending=changed.length;pdfFormIndexInventoryCount=full?rows.length:pdfFormIndexInventoryCount;
  if(removalRecords.length)await appendPdfIndexJournal(removalRecords);
  return {pdfCount:rows.length,changed:changed.length,removed};
}
async function refreshPdfFormIndex({maxChanged=PDF_FORM_MAINTENANCE_MAX_FILES,onProgress=null,force=false,reason='scheduled'}={}){
  if(shuttingDown||pdfMaintenanceStopRequested)return {pdfCount:pdfFormIndexInventoryCount,changed:pdfFormIndexPending,processed:0,pending:pdfFormIndexPending,indexed:0,failed:0,removed:0,cached:pdfFormIndex.size,interactive:[...pdfFormIndex.values()].filter(entry=>entry.hasForm&&!entry.failed).length,aborted:true,elapsedMs:0};
  if(pdfFormIndexRefreshPromise)return pdfFormIndexRefreshPromise;
  const controller=new AbortController();pdfFormIndexRefreshAbortController=controller;
  const limitTimer=setTimeout(()=>controller.abort(),PDF_FORM_MAINTENANCE_MAX_MS);limitTimer.unref?.();
  const task=(async()=>{
    await loadPdfFormIndex();const started=Date.now(),cpuStarted=process.cpuUsage();let removed=0,indexed=0,failed=0,processed=0,aborted=false,bytesRead=0;
    const maintenance=await readJsonFile(PDF_FORM_MAINTENANCE_PATH,{});
    if(!force&&!maintenance.lastFailureAt&&Number(maintenance.lastResult?.pending)===0&&Date.parse(String(maintenance.lastSuccessfulAt||''))>started-PDF_FORM_MAINTENANCE_INTERVAL_MS)return {skipped:true,reason:'not-due',pending:pdfFormIndexPending,processed:0};
    maintenance.lastAttemptAt=new Date(started).toISOString();await writeJsonFile(PDF_FORM_MAINTENANCE_PATH,maintenance);
    const {full,modifiedSince}=pdfMaintenanceInventoryPlan({force,now:started,lastReconcileAt:maintenance.lastReconcileAt,lastIncrementalScanAt:maintenance.lastIncrementalScanAt,reconcileIntervalMs:PDF_FORM_RECONCILE_INTERVAL_MS});
    const inventory=await rebuildPdfFormIndexBacklog({signal:controller.signal,full,modifiedSince});removed=inventory.removed;
    if(shuttingDown||controller.signal.aborted){const error=new Error('PDF maintenance stopped');error.code='ABORT_ERR';throw error}
    const changedBefore=pdfFormIndexBacklog.length,boundedMax=Number.isFinite(Number(maxChanged))?Math.max(0,Math.trunc(Number(maxChanged))):changedBefore;
    const selected=pdfFormIndexBacklog.splice(0,boundedMax);
    if(typeof onProgress==='function')onProgress({phase:'start',pdfCount:pdfFormIndexInventoryCount,changed:changedBefore,selected:selected.length,processed:0,indexed,failed});
    for(const row of selected){
      if(shuttingDown||controller.signal.aborted||Date.now()-started>=PDF_FORM_MAINTENANCE_MAX_MS){aborted=true;break}
      const key=pdfIndexKey(row.fullPath);
      try{
        const extracted=await extractInteractivePdfText(row.fullPath,{maxBytes:PDF_FORM_MAX_BYTES,signal:controller.signal,onBytesRead:count=>{bytesRead+=count}});
        const fileStat=await fs.stat(row.fullPath).catch(()=>null);
        const entry={...row,rootId:'everything',rootLabel:'Everything',fingerprint:row.fingerprint,fileMtimeMs:fileStat?.mtimeMs||0,detectionRevision:PDF_FORM_DETECTION_REVISION,searchTextRevision:PDF_FORM_SEARCH_TEXT_REVISION,geometryRevision:PDF_FORM_GEOMETRY_REVISION,hasForm:!!extracted.hasForm,text:extracted.hasForm?extracted.text:'',formFields:extracted.hasForm?normalizePdfFormFields(extracted.formFields):[],formFieldCount:extracted.hasForm?extracted.formFieldCount:0,failed:false,error:'',retryAfter:'',retryCount:0};pdfFormIndex.set(key,entry);previewTextCache.delete(key);await appendPdfIndexJournal([{op:'upsert',entry:serializePdfIndexEntry(entry)}]);
        if(extracted.hasForm)indexed+=1;
      }catch(error){
        if(isAbortError(error)||shuttingDown||controller.signal.aborted){aborted=true;break}
        const previous=pdfFormIndex.get(key),retryCount=previous?.fingerprint===row.fingerprint?Math.min(8,(previous.retryCount||0)+1):1;
        const retryMs=/No password given/i.test(String(error?.message||''))?30*PDF_FORM_RETRY_MS:Math.min(7*PDF_FORM_RETRY_MS,PDF_FORM_RETRY_MS*2**(retryCount-1));
        const entry={...row,rootId:'everything',rootLabel:'Everything',fingerprint:row.fingerprint,detectionRevision:PDF_FORM_DETECTION_REVISION,searchTextRevision:PDF_FORM_SEARCH_TEXT_REVISION,geometryRevision:0,hasForm:false,text:'',formFields:[],formFieldCount:0,failed:true,error:String(error?.message||error),retryAfter:new Date(Date.now()+retryMs).toISOString(),retryCount};pdfFormIndex.set(key,entry);previewTextCache.delete(key);await appendPdfIndexJournal([{op:'upsert',entry:serializePdfIndexEntry(entry)}]);failed+=1;
        await appendLog(`PDF_FORM_INDEX_FILE_FAILED path=${JSON.stringify(row.fullPath)} error=${JSON.stringify(String(error?.message||error))}`);
      }
      processed+=1;if(typeof onProgress==='function')onProgress({phase:'file',pdfCount:pdfFormIndexInventoryCount,changed:changedBefore,selected:selected.length,processed,indexed,failed,name:row.name});
    }
    if(processed<selected.length)pdfFormIndexBacklog.unshift(...selected.slice(processed));
    const pending=pdfFormIndexBacklog.length;pdfFormIndexPending=pending;
    await compactPdfFormIndex({pending,pdfCount:pdfFormIndexInventoryCount});
    if(!aborted&&pending===0){maintenance.lastIncrementalScanAt=new Date(started).toISOString();if(full)maintenance.lastReconcileAt=new Date(started).toISOString();maintenance.lastSuccessfulAt=new Date().toISOString()}
    delete maintenance.lastFailureAt;delete maintenance.lastFailure;
    maintenance.lastResult={reason,full,modifiedSince,pdfCount:inventory.pdfCount,changed:changedBefore,processed,pending,indexed,failed,removed,bytesRead,aborted,elapsedMs:Date.now()-started};await writeJsonFile(PDF_FORM_MAINTENANCE_PATH,maintenance);
    const interactive=[...pdfFormIndex.values()].filter(entry=>entry.hasForm&&!entry.failed).length;
    const cpu=process.cpuUsage(cpuStarted),elapsedMs=Date.now()-started;
    await appendLog(`PDF_FORM_INDEX_MAINTENANCE trigger=${reason} mode=${full?'reconcile':'incremental'} pdfs=${inventory.pdfCount} changed=${changedBefore} processed=${processed} pending=${pending} inspected=${pdfFormIndex.size} interactive=${interactive} indexed=${indexed} failed=${failed} removed=${removed} bytesRead=${bytesRead} cpuMs=${Math.round((cpu.user+cpu.system)/1000)} aborted=${aborted} elapsedMs=${elapsedMs}`);
    return {pdfCount:inventory.pdfCount,changed:changedBefore,processed,pending,indexed,failed,removed,cached:pdfFormIndex.size,interactive,aborted,bytesRead,cpuMs:Math.round((cpu.user+cpu.system)/1000),elapsedMs};
  })();
  pdfFormIndexRefreshPromise=task;
  try{return await task}catch(error){
    const maintenance=await readJsonFile(PDF_FORM_MAINTENANCE_PATH,{});
    if(controller.signal.aborted||isAbortError(error)){
      const result={aborted:true,processed:0,pending:pdfFormIndexPending,elapsedMs:Date.now()-Date.parse(maintenance.lastAttemptAt||new Date().toISOString())};
      maintenance.lastResult={reason, ...result};delete maintenance.lastFailureAt;delete maintenance.lastFailure;
      await writeJsonFile(PDF_FORM_MAINTENANCE_PATH,maintenance).catch(()=>{});
      await appendLog(`PDF_FORM_INDEX_MAINTENANCE_STOPPED trigger=${reason} pending=${result.pending}`);
      return result;
    }
    maintenance.lastFailureAt=new Date().toISOString();maintenance.lastFailure=String(error?.message||error);
    await writeJsonFile(PDF_FORM_MAINTENANCE_PATH,maintenance).catch(()=>{});
    await appendLog(`PDF_FORM_INDEX_MAINTENANCE_FAILED trigger=${reason} error=${JSON.stringify(maintenance.lastFailure)}`);
    throw error;
  }finally{clearTimeout(limitTimer);if(pdfFormIndexRefreshPromise===task)pdfFormIndexRefreshPromise=null;if(pdfFormIndexRefreshAbortController===controller)pdfFormIndexRefreshAbortController=null}
}
async function preparePdfFormIndexForSearch(){
  try{await loadPdfFormIndex()}catch(error){await appendLog(`PDF_FORM_INDEX_LOAD_FAILED ${error?.message||error}`);return {partial:true}}
  return {partial:!pdfFormIndexLastRefresh||pdfFormIndexPending>0};
}
async function extractPdfOnDemand(fullPath,{includePageText=true}={}){
  return await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(RUNTIME_ROOT,'pdf-extract-worker.mjs')],{cwd:APP_ROOT,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',errors='',finished=false;
    const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);if(error)reject(error);else resolve(result)};
    const timer=setTimeout(()=>{child.kill();finish(new Error('PDF on-demand extraction timed out'))},25000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>32*1024*1024){child.kill();finish(new Error('PDF worker output too large'))}});
    child.stderr.on('data',chunk=>{if(errors.length<4096)errors+=chunk});
    child.on('error',finish);
    child.on('close',code=>{try{const response=JSON.parse(output.trim());if(!response.ok)throw new Error(response.error||errors||'PDF extraction failed');finish(null,response.result)}catch(error){finish(new Error(`PDF worker exited ${code}: ${error.message}`))}});
    child.stdin.end(JSON.stringify({fullPath,includePageText}));
  });
}
function searchPdfFormIndex(query,contentSearch,scopePath,limit,sort={}){
  const results=[];
  for(const entry of pdfFormIndex.values()){
    if(!entry.hasForm||!entry.text||entry.failed||!pdfIndexInScope(entry.fullPath,scopePath))continue;
    if(!contentSearchMatches(entry.text,query,contentSearch))continue;
    results.push(entry);
  }
  results.sort((a,b)=>compareDocumentRows(a,b,sort));
  return results.slice(0,Math.max(1,Number(limit)||DEFAULT_RESULT_LIMIT));
}
async function supplementalPdfData(row,stat){
  const fullPath=row.fullPath;
  try{await loadPdfFormIndex()}catch(error){await appendLog(`PDF_FORM_INDEX_LOAD_FAILED ${error?.message||error}`);return null}
  const key=pdfIndexKey(fullPath),cached=pdfFormIndex.get(key),detectionCurrent=Number(cached?.detectionRevision)===PDF_FORM_DETECTION_REVISION;
  const cachedDate=Number(cached?.fileMtimeMs)||Date.parse(String(cached?.modified||'')),fingerprintCurrent=!!cached&&Number(cached.size)===stat.size&&Number.isFinite(cachedDate)&&Math.abs(cachedDate-stat.mtimeMs)<1000;
  if(fingerprintCurrent&&cached?.hasForm&&cached.text&&cached.formFields?.length&&Number(cached.searchTextRevision)>=PDF_FORM_SEARCH_TEXT_REVISION&&Number(cached.geometryRevision)>=PDF_FORM_GEOMETRY_REVISION)return {...trimPreviewText(cached.text),formFields:normalizePdfFormFields(cached.formFields)};
  // A negative result from an older extractor is not authoritative. Earlier
  // releases persisted `hasForm:false` without an extractor revision, which can
  // leave an interactive PDF permanently searchable only through Everything and
  // therefore without page rectangles for preview highlighting. Re-open such a
  // file once on demand and persist the new verdict immediately.
  if(fingerprintCurrent&&detectionCurrent&&cached&&!cached.hasForm&&!cached.failed)return null;
  try{
    // v28 indexes can already contain the searchable AcroForm text but not the
    // page/rectangle metadata needed by the preview. Re-reading all page text on
    // click is unnecessary and can time out on large PDFs; recover only the form
    // annotations and keep the proven cached search text. Scheduled maintenance
    // later compacts the journal into the current schema.
    const geometryOnly=!!(fingerprintCurrent&&cached?.hasForm&&cached.text&&Number(cached.searchTextRevision)>=PDF_FORM_SEARCH_TEXT_REVISION&&(!cached.formFields?.length||Number(cached.geometryRevision)<PDF_FORM_GEOMETRY_REVISION));
    const extracted=await extractPdfOnDemand(fullPath,{includePageText:!geometryOnly});
    if(extracted.hasForm&&extracted.formFields?.length){
      const formFields=normalizePdfFormFields(extracted.formFields),text=geometryOnly?cached.text:extracted.text,data={...trimPreviewText(text),formFields};
      const base=fingerprintCurrent?cached:{...row,fullPath,name:row.name||path.win32.basename(fullPath),relativePath:row.relativePath||path.win32.dirname(fullPath),modified:row.modified||stat.mtime.toISOString(),size:stat.size,attributes:row.attributes||'',fingerprint:pdfIndexFingerprint({size:stat.size,modified:row.modified||stat.mtime.toISOString()})};
      const updated={...base,fileMtimeMs:stat.mtimeMs,detectionRevision:PDF_FORM_DETECTION_REVISION,searchTextRevision:geometryOnly?cached.searchTextRevision:PDF_FORM_SEARCH_TEXT_REVISION,geometryRevision:PDF_FORM_GEOMETRY_REVISION,hasForm:true,text,formFields,formFieldCount:extracted.formFieldCount||formFields.length,failed:false,error:'',retryAfter:'',retryCount:0};pdfFormIndex.set(key,updated);previewTextCache.delete(key);await appendPdfIndexJournal([{op:'upsert',entry:serializePdfIndexEntry(updated)}]);
      return data;
    }
    const base=fingerprintCurrent?cached:{...row,fullPath,name:row.name||path.win32.basename(fullPath),relativePath:row.relativePath||path.win32.dirname(fullPath),modified:row.modified||stat.mtime.toISOString(),size:stat.size,attributes:row.attributes||'',fingerprint:pdfIndexFingerprint({size:stat.size,modified:row.modified||stat.mtime.toISOString()})};
    const updated={...base,fileMtimeMs:stat.mtimeMs,detectionRevision:PDF_FORM_DETECTION_REVISION,searchTextRevision:PDF_FORM_SEARCH_TEXT_REVISION,geometryRevision:0,hasForm:false,text:'',formFields:[],formFieldCount:0,failed:false,error:'',retryAfter:'',retryCount:0};pdfFormIndex.set(key,updated);previewTextCache.delete(key);await appendPdfIndexJournal([{op:'upsert',entry:serializePdfIndexEntry(updated)}]);
  }catch(error){await appendLog(`PDF_FORM_PREVIEW_FAILED path=${JSON.stringify(fullPath)} error=${JSON.stringify(String(error?.message||error))}`)}
  return null;
}
async function searchDocuments(query,limit,mode='everything',contentSearch={},scopePath='',offset=0,sort={},fileType='all'){
  const normalizedMode=normalizeDocumentSearchMode(mode),normalizedContentSearch=normalizeContentSearchOptions(contentSearch),normalizedScope=normalizeSearchScopePath(scopePath),normalizedSort=normalizeDocumentSort(sort),normalizedFileType=normalizeDocumentFileType(fileType),everythingQuery=buildDocumentQuery(query,normalizedMode,normalizedContentSearch,normalizedFileType);
  if(!everythingQuery){const e=new Error(normalizedMode==='content'?'יש להקליד לפחות שני תווים לחיפוש בתוכן הקבצים.':'יש להקליד לפחות תו אחד לחיפוש ב-Everything.');e.code='QUERY_TOO_SHORT';throw e}
  const pageOffset=Math.max(0,Math.min(MAX_RESULTS,Math.trunc(Number(offset)||0))),available=Math.max(0,MAX_RESULTS-pageOffset),boundedLimit=Math.min(available,Math.max(1,Math.trunc(Number(limit)||DEFAULT_RESULT_LIMIT)));
  if(!boundedLimit)return {ok:true,bridgeVersion:BRIDGE_VERSION,query:String(query||'').trim(),mode:normalizedMode,contentSearch:normalizedContentSearch,fileType:normalizedFileType,scopePath:normalizedScope,sort:normalizedSort,offset:pageOffset,limit:0,results:[],hasMore:false,maxResults:MAX_RESULTS,elapsedMs:0,partial:false,rootErrors:[]};
  const wanted=Math.min(MAX_RESULTS,pageOffset+boundedLimit+1);let rows=[],supplemental=[],elapsedMs=0,pageRows=[],hasMore=false,partial=false;
  if(normalizedMode==='everything'){
    const result=await runEverythingJson((config,probe)=>buildEsSearchArgs({query,mode:normalizedMode,contentSearch:normalizedContentSearch,fileType:normalizedFileType,limit:Math.min(boundedLimit+1,available),offset:pageOffset,timeoutMs:config.searchTimeoutMs,instance:probe.instance,scopePath:normalizedScope,sort:normalizedSort}));rows=result.rows;elapsedMs=result.elapsedMs;pageRows=rows.slice(0,boundedLimit);hasMore=rows.length>boundedLimit&&pageOffset+boundedLimit<MAX_RESULTS;
  }else{
    const [result,indexState]=await Promise.all([runEverythingJson((config,probe)=>buildEsSearchArgs({query,mode:normalizedMode,contentSearch:normalizedContentSearch,fileType:normalizedFileType,limit:wanted,offset:0,timeoutMs:config.searchTimeoutMs,instance:probe.instance,scopePath:normalizedScope,sort:normalizedSort})),preparePdfFormIndexForSearch()]);rows=result.rows;elapsedMs=result.elapsedMs;supplemental=documentFileTypeIncludesPdf(normalizedFileType)?searchPdfFormIndex(query,normalizedContentSearch,normalizedScope,wanted,normalizedSort):[];const merged=mergeDocumentResults([rows,supplemental],wanted,MAX_RESULTS).sort((a,b)=>compareDocumentRows(a,b,normalizedSort));pageRows=merged.slice(pageOffset,pageOffset+boundedLimit);hasMore=merged.length>pageOffset+pageRows.length&&pageOffset+boundedLimit<MAX_RESULTS;partial=indexState.partial;
  }
  pruneResults();const results=pageRows.map(row=>publicResult(row,{query,mode:normalizedMode,contentSearch:normalizedContentSearch}));
  await appendLog(`SEARCH mode=${normalizedMode} offset=${pageOffset} limit=${boundedLimit} hasMore=${hasMore} partial=${partial} contentSearch=${JSON.stringify(normalizedContentSearch)} fileType=${normalizedFileType} sort=${normalizedSort.field}:${normalizedSort.direction} scope=everything-index+interactive-pdf scopePath=${JSON.stringify(normalizedScope)} results=${results.length} everythingResults=${rows.length} pdfSupplemental=${supplemental.length} elapsedMs=${elapsedMs} input=${JSON.stringify(String(query||''))} everythingQuery=${JSON.stringify(everythingQuery)}`);
  return {ok:true,bridgeVersion:BRIDGE_VERSION,query:String(query||'').trim(),mode:normalizedMode,contentSearch:normalizedContentSearch,fileType:normalizedFileType,scopePath:normalizedScope,sort:normalizedSort,offset:pageOffset,limit:boundedLimit,results,hasMore,maxResults:MAX_RESULTS,elapsedMs,partial,rootErrors:[]};
}
async function recentDocuments(limit,scopePath='',fileType='all'){
  const normalizedScope=normalizeSearchScopePath(scopePath),normalizedFileType=normalizeDocumentFileType(fileType),boundedLimit=Math.min(RECENT_RESULT_LIMIT,Math.max(1,Number(limit)||RECENT_RESULT_LIMIT));
  const {rows,elapsedMs}=await runEverythingJson((config,probe)=>buildEsRecentFilesArgs({limit:boundedLimit,timeoutMs:config.searchTimeoutMs,instance:probe.instance,scopePath:normalizedScope,fileType:normalizedFileType}));
  pruneResults();const results=mergeDocumentResults([rows],boundedLimit,RECENT_RESULT_LIMIT).map(row=>publicResult(row,{query:'',mode:'everything'}));
  await appendLog(`RECENT scope=everything-index scopePath=${JSON.stringify(normalizedScope)} fileType=${normalizedFileType} sort=date-modified-descending results=${results.length} elapsedMs=${elapsedMs}`);
  return {ok:true,bridgeVersion:BRIDGE_VERSION,mode:'recent',fileType:normalizedFileType,scopePath:normalizedScope,results,elapsedMs,partial:false,rootErrors:[]};
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
  const child=spawn(NATIVE_PREVIEW_HOST,[],{windowsHide:true,stdio:['pipe','pipe','pipe'],cwd:APP_ROOT});nativePreviewProcess=child;
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
  const extension=documentExtension(row.fullPath),officeKind=officePreviewKind(extension);if(!officeKind){const e=new Error('תצוגת Windows המקורית מופעלת כרגע למסמכי Office בלבד.');e.code='NATIVE_PREVIEW_UNSUPPORTED';throw e}
  const box=normalizePreviewGeometry(geometry),encoded=Buffer.from(row.fullPath,'utf8').toString('base64');
  const response=await nativePreviewCommand('OPEN',[encoded,box.x,box.y,box.width,box.height],9000);await appendLog(`NATIVE_PREVIEW_OPEN kind=${officeKind} geometry=${box.x},${box.y},${box.width}x${box.height} handler=${JSON.stringify(response)} path=${JSON.stringify(row.fullPath)}`);return {ok:true,kind:'native',officeKind};
}
async function moveNativePreview(geometry){const box=normalizePreviewGeometry(geometry);if(!nativePreviewProcess)return {ok:true,visible:false};await nativePreviewCommand('MOVE',[box.x,box.y,box.width,box.height],2500);return {ok:true,visible:true}}
async function hideNativePreview(){if(!nativePreviewProcess)return {ok:true};try{await nativePreviewCommand('HIDE',[],2500)}catch{}return {ok:true}}
async function selectSearchFolder(){
  if(process.platform!=='win32'){const e=new Error('בחירת תיקיית חיפוש נתמכת רק ב-Windows.');e.code='WINDOWS_REQUIRED';throw e}
  const response=await nativePreviewCommand('PICK_FOLDER',[],120000);
  if(response==='CANCELLED')return {ok:true,bridgeVersion:BRIDGE_VERSION,cancelled:true,path:'',label:''};
  const prefix='PICKED ';if(!String(response||'').startsWith(prefix)){const e=new Error('בורר התיקיות החזיר תשובה לא תקינה.');e.code='FOLDER_PICKER_INVALID_RESPONSE';throw e}
  let selected='';try{selected=Buffer.from(String(response).slice(prefix.length),'base64').toString('utf8')}catch{}
  const normalized=normalizeSearchScopePath(selected);if(!normalized){const e=new Error('לא נבחרה תיקייה תקינה.');e.code='FOLDER_PICKER_INVALID_PATH';throw e}
  const label=path.win32.basename(normalized)||path.win32.parse(normalized).root.replace(/[\\]+$/,'')||normalized;
  await appendLog(`SEARCH_SCOPE_PICK path=${JSON.stringify(normalized)}`);
  return {ok:true,bridgeVersion:BRIDGE_VERSION,cancelled:false,path:normalized,label};
}
async function stopNativePreview(){
  const child=nativePreviewProcess;if(!child)return;const pid=Number(child.pid)||0;
  try{await nativePreviewCommand('EXIT',[],1500)}catch{}
  if(pid&&!(await waitForProcessExit(pid,1200))){try{child.kill()}catch{};await waitForProcessExit(pid,800)}
  if(pid&&await processAlive(pid)){await appendLog(`NATIVE_PREVIEW_FORCE_STOP pid=${pid}`);await forceStopProcessTree(pid);await waitForProcessExit(pid,1500)}
  nativePreviewProcess=null;
}
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
  prunePreviewTextCache();const key=String(row.fullPath||'').toLocaleLowerCase('en-US'),extension=documentExtension(row.fullPath),fingerprint=`${Number(stat.size)||0}:${Number(stat.mtimeMs)||0}${extension==='pdf'?`:pdf-search-${PDF_FORM_SEARCH_TEXT_REVISION}:geometry-${PDF_FORM_GEOMETRY_REVISION}`:''}`;
  const cached=previewTextCache.get(key);if(cached&&cached.fingerprint===fingerprint){cached.at=Date.now();previewTextCache.delete(key);previewTextCache.set(key,cached);return cached.data}
  let data=null;
  if(TEXT_EXTENSIONS.has(extension)){const direct=await readTextPreview(row.fullPath,stat);data={...direct,source:'file'}}
  else if(extension==='pdf'){
    const [everythingText,pdfData]=await Promise.all([readEverythingContentPreview(row.fullPath),supplementalPdfData(row,stat)]);
    if(pdfData?.text)data={...pdfData,source:'pdfjs-acroform'};else if(everythingText?.text)data={...everythingText,source:'everything-content'};
  }else{const extracted=await readEverythingContentPreview(row.fullPath);if(extracted)data={...extracted,source:'everything-content'}}
  if(data){previewTextCache.set(key,{fingerprint,at:Date.now(),data});prunePreviewTextCache()}
  return data;
}
async function previewMatches(id){
  const {row,stat}=await resolveResult(id),query=normalizeSearchText(row.query);
  if(row.mode!=='content'||query.length<2||stat.isDirectory())return {ok:true,bridgeVersion:BRIDGE_VERSION,active:false,query:'',count:0,snippets:[]};
  const started=Date.now(),content=await searchablePreviewText(row,stat);
  if(!content?.text)return {ok:true,bridgeVersion:BRIDGE_VERSION,active:true,query,count:0,snippets:[],truncated:false,source:'unavailable',elapsedMs:Date.now()-started};
  const extension=documentExtension(row.fullPath);
  const search=normalizeContentSearchOptions(row.contentSearch),matches=extension==='pdf'?buildContentMatchInfo(content.text,query,{...search,contextChars:96,maxSnippets:500,maxMatches:500}):buildContentMatchInfo(content.text,query,search);
  const canBuildFormAnchors=extension==='pdf'&&Array.isArray(content.formFields),formMatchInfo=canBuildFormAnchors?buildPdfFormMatchAnchors(content.formFields,query,search,5000):{anchors:[],capped:false},formAnchorsAuthoritative=formMatchInfo.anchors.length>0;
  await appendLog(`PREVIEW_MATCHES count=${matches.count} snippets=${matches.snippets.length} formAnchors=${formMatchInfo.anchors.length} authoritative=${formAnchorsAuthoritative} source=${content.source} elapsedMs=${Date.now()-started} path=${JSON.stringify(row.fullPath)}`);
  return {ok:true,bridgeVersion:BRIDGE_VERSION,active:true,...matches,formAnchors:formMatchInfo.anchors,formAnchorsCapped:formMatchInfo.capped,formAnchorsAuthoritative,truncated:!!content.truncated,source:content.source,elapsedMs:Date.now()-started};
}
function previewMetadata(row,stat){const extension=documentExtension(row.fullPath);return {name:path.win32.basename(row.fullPath),path:path.win32.dirname(row.fullPath),fullPath:row.fullPath,extension,size:Number(stat.size)||0,isDirectory:stat.isDirectory(),modified:stat.mtime?.toISOString?.()||''}}
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
  const extension=documentExtension(row.fullPath);
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

async function invalidateResultPath(fullPath){
  const target=String(fullPath||'').toLocaleLowerCase('en-US'),invalidatedIds=[];
  for(const [resultId,result] of requestResults){if(String(result.fullPath||'').toLocaleLowerCase('en-US')!==target)continue;requestResults.delete(resultId);invalidatedIds.push(resultId)}
  previewTextCache.delete(target);await loadPdfFormIndex();if(pdfFormIndex.delete(target))await appendPdfIndexJournal([{op:'remove',fullPath}]);
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
  const invalidatedIds=await invalidateResultPath(row.fullPath);
  await appendLog(`DELETE type=${stat.isDirectory()?'folder':'file'} recycle=SendToRecycleBin invalidated=${invalidatedIds.length} path=${JSON.stringify(row.fullPath)}`);
  return {ok:true,type:stat.isDirectory()?'folder':'file',invalidatedIds};
}

async function handle(req,res){
  const config=await loadConfig(),origin=String(req.headers.origin||'');
  if(origin&&!originAllowed(origin,config.allowedOrigins)){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'});res.end(JSON.stringify({ok:false,code:'ORIGIN_NOT_ALLOWED',message:'מקור האתר אינו מורשה לגשת ל-Document Bridge.'}));return}
  if(req.method==='OPTIONS'){res.writeHead(204,corsHeaders(req,config));res.end();return}
  if(req.method==='GET'&&req.url==='/health'){sendJson(req,res,200,{ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,pid:process.pid},config);return}
  const expected=await ensureToken();if(!tokenEqual(expected,authToken(req))){sendJson(req,res,401,{ok:false,code:'UNAUTHORIZED',message:'מפתח Document Bridge שגוי או חסר.'},config);return}
  try{
    if(req.method==='GET'&&req.url==='/status'){
      const {probe,diagnostics}=await diagnoseIndex({freshProbe:true});
      let pdfIndexError='';try{await loadPdfFormIndex()}catch(error){pdfIndexError=String(error?.message||error)}
      const interactivePdfCount=[...pdfFormIndex.values()].filter(entry=>entry.hasForm&&!entry.failed).length,maintenance=await readJsonFile(PDF_FORM_MAINTENANCE_PATH,{});sendJson(req,res,200,{ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,esVersion:probe.esVersion,everythingVersion:probe.everythingVersion,everythingExecutable:probe.everythingExecutable||'',instance:probe.instance,index:{fileCount:diagnostics.fileCount,indexedContentCount:diagnostics.indexedContentCount,sampleOk:diagnostics.sampleOk,error:[diagnostics.error,pdfIndexError].filter(Boolean).join('; '),interactivePdfCount,inspectedPdfCount:pdfFormIndex.size,interactivePdfPending:pdfFormIndexPending,interactivePdfUpdatedAt:pdfFormIndexLastRefresh?new Date(pdfFormIndexLastRefresh).toISOString():'',maintenanceLastAttemptAt:maintenance.lastAttemptAt||'',maintenanceLastSuccessfulAt:maintenance.lastSuccessfulAt||'',maintenanceLastFailureAt:maintenance.lastFailureAt||'',maintenanceLastFailure:maintenance.lastFailure||'',maintenanceLastResult:maintenance.lastResult||null}},config);return;
    }
    if(req.method==='POST'&&req.url==='/documents/warm'){const probe=await probeEverything({autoStart:true});sendJson(req,res,200,{ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,everythingVersion:probe.everythingVersion,instance:probe.instance},config);return}
    if(req.method==='GET'&&req.url==='/documents/pdf-index/status'){sendJson(req,res,200,await pdfMaintenanceStatus(),config);return}
    if(req.method==='POST'&&req.url==='/documents/pdf-index/start'){sendJson(req,res,200,await startManualPdfMaintenance(),config);return}
    if(req.method==='POST'&&req.url==='/documents/pdf-index/stop'){sendJson(req,res,200,await stopManualPdfMaintenance(),config);return}
    if(req.method==='POST'&&req.url==='/documents/select-folder'){const result=await selectSearchFolder();sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/recent'){const body=await readJson(req),result=await recentDocuments(body.limit,body.scopePath,body.fileType);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/search'){const body=await readJson(req),result=await searchDocuments(body.query,body.limit,body.mode,body.contentSearch,body.scopePath,body.offset,body.sort,body.fileType);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/preview'){const body=await readJson(req),result=await previewDocument(body.id);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/matches'){const body=await readJson(req),result=await previewMatches(body.id);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/preview-file'){const body=await readJson(req),result=await readBinaryPreview(body.id);sendBinary(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/native-preview'){const body=await readJson(req),result=await openNativePreview(body.id,body.geometry);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/native-preview/move'){const body=await readJson(req),result=await moveNativePreview(body.geometry);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/native-preview/hide'){const result=await hideNativePreview();sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/open'){const body=await readJson(req),result=await openDocument(body.id);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/reveal'){const body=await readJson(req),result=await revealDocument(body.id);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/documents/delete'){const body=await readJson(req),result=await deleteDocument(body.id);sendJson(req,res,200,result,config);return}
    if(req.method==='POST'&&req.url==='/shutdown'){shuttingDown=true;await stopManualPdfMaintenance().catch(()=>{});await stopNativePreview();sendJson(req,res,200,{ok:true,pid:process.pid},config);setTimeout(()=>{server?.close(async()=>{await appendLog('STOP graceful shutdown complete');process.exitCode=0})},20);setTimeout(()=>{process.exit(0)},2500).unref?.();return}
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
async function bridgeListenerPid(){
  if(process.platform!=='win32')return 0;
  try{const {stdout}=await execFile('netstat.exe',['-ano','-p','tcp'],{encoding:'utf8',windowsHide:true,timeout:3000});for(const line of stdout.split(/\r?\n/)){const parts=line.trim().split(/\s+/);if(parts.length<5||String(parts[0]).toUpperCase()!=='TCP'||String(parts[3]).toUpperCase()!=='LISTENING')continue;const local=String(parts[1]||'');if(!local.endsWith(`:${BRIDGE_PORT}`))continue;const pid=Number(parts[4]);if(Number.isInteger(pid)&&pid>0)return pid}}catch{}return 0;
}
async function processAlive(pid){
  if(process.platform!=='win32'||!Number.isInteger(Number(pid))||Number(pid)<=0)return false;
  try{const {stdout}=await execFile('tasklist.exe',['/FI',`PID eq ${Number(pid)}`,'/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true,timeout:3000});return stdout.split(/\r?\n/).some(line=>line.includes(`\"${Number(pid)}\"`))}catch{return false}
}
async function forceStopProcessTree(pid){
  if(process.platform!=='win32'||!Number.isInteger(Number(pid))||Number(pid)<=0)return;
  try{await execFile('taskkill.exe',['/PID',String(Number(pid)),'/T','/F'],{encoding:'utf8',windowsHide:true,timeout:5000})}catch(error){if(await processAlive(pid))throw error}
}
async function waitForProcessExit(pid,timeoutMs){
  if(!pid)return true;const deadline=Date.now()+Math.max(0,Number(timeoutMs)||0);while(Date.now()<deadline){if(!(await processAlive(pid)))return true;await new Promise(r=>setTimeout(r,150))}return !(await processAlive(pid));
}
async function stopExisting(){
  let health;try{health=await loopbackRequest('/health',{timeoutMs:900})}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code)))return;throw error}
  if(health.statusCode!==200||health.data?.service!==BRIDGE_SERVICE){const e=new Error(`Port ${BRIDGE_PORT} is already in use by another service.`);e.code='PORT_IN_USE';throw e}
  const listenerPid=Number(health.data?.pid)||await bridgeListenerPid();
  let token='';try{token=(await fs.readFile(TOKEN_PATH,'utf8')).trim()}catch{}if(!token){const e=new Error('Existing Document Bridge is running but its local token is unavailable.');e.code='TOKEN_MISSING';throw e}
  const response=await loopbackRequest('/shutdown',{method:'POST',token,timeoutMs:2500});if(response.statusCode!==200){const e=new Error(`Existing Document Bridge refused shutdown (HTTP ${response.statusCode}).`);e.code='SHUTDOWN_FAILED';throw e}
  const portDeadline=Date.now()+3500;let portClosed=false;while(Date.now()<portDeadline){await new Promise(r=>setTimeout(r,120));try{await loopbackRequest('/health',{timeoutMs:300})}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code))){portClosed=true;break}}}
  if(listenerPid&&!(await waitForProcessExit(listenerPid,1500))){await appendLog(`INSTALL_STOP_FORCE pid=${listenerPid} reason=${JSON.stringify(portClosed?'listener-closed-process-still-running':'shutdown-timeout')}`);await forceStopProcessTree(listenerPid);if(!(await waitForProcessExit(listenerPid,2500))){const e=new Error(`Existing Document Bridge process ${listenerPid} could not be terminated.`);e.code='SHUTDOWN_PROCESS_STUCK';throw e}}
  try{await loopbackRequest('/health',{timeoutMs:500});const e=new Error('Existing Document Bridge listener is still active after shutdown.');e.code='SHUTDOWN_TIMEOUT';throw e}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code)))return;throw error}
}

function taskResultLabel(value){
  const numeric=Number(value);if(!Number.isFinite(numeric))return 'unknown';const unsigned=numeric>>>0;return `${Math.trunc(numeric)} (0x${unsigned.toString(16).toUpperCase().padStart(8,'0')})`;
}
async function pdfMaintenanceTaskDiagnostics(){
  if(process.platform!=='win32')return {exists:false,unsupported:true,state:'',enabled:false,triggerEnabled:false,lastRunTime:'',lastResult:null,nextRunTime:'',missedRuns:0,actionValid:false,scheduleActive:false,error:''};
  const script=[
    "$ErrorActionPreference='Stop'",
    `$task=Get-ScheduledTask -TaskName '${PDF_MAINTENANCE_TASK_NAME}' -ErrorAction Stop`,
    `$info=Get-ScheduledTaskInfo -TaskName '${PDF_MAINTENANCE_TASK_NAME}' -ErrorAction Stop`,
    '$action=@($task.Actions)[0]',
    '$triggers=@($task.Triggers)',
    "$lastRun=if($info.LastRunTime.Year -gt 1900){$info.LastRunTime.ToString('o')}else{''}",
    "$nextRun=if($info.NextRunTime.Year -gt 1900){$info.NextRunTime.ToString('o')}else{''}",
    "$triggerEnabled=(@($triggers | Where-Object { $_.Enabled -ne $false }).Count -gt 0)",
    "[pscustomobject]@{state=[string]$task.State;enabled=([string]$task.State -ne 'Disabled');triggerEnabled=[bool]$triggerEnabled;lastRunTime=$lastRun;lastResult=[int64]$info.LastTaskResult;nextRunTime=$nextRun;missedRuns=[int]$info.NumberOfMissedRuns;execute=[string]$action.Execute;arguments=[string]$action.Arguments;workingDirectory=[string]$action.WorkingDirectory}|ConvertTo-Json -Compress",
  ].join(';');
  try{
    const {stdout}=await execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{encoding:'utf8',windowsHide:true,timeout:8000,maxBuffer:1024*1024});
    const raw=JSON.parse(String(stdout||'').trim());const expectedRunner=path.join(APP_ROOT,'run_pdf_maintenance.ps1');
    const executeLeaf=path.win32.basename(String(raw.execute||'')).toLocaleLowerCase('en-US'),argumentsText=String(raw.arguments||'').toLocaleLowerCase('en-US'),working=String(raw.workingDirectory||'');
    const actionValid=executeLeaf==='powershell.exe'&&argumentsText.includes(expectedRunner.toLocaleLowerCase('en-US'))&&normalizedRuntimePath(working)===normalizedRuntimePath(APP_ROOT);
    const enabled=raw.enabled===true,triggerEnabled=raw.triggerEnabled===true,nextRunTime=String(raw.nextRunTime||''),scheduleActive=enabled&&triggerEnabled&&!!nextRunTime&&actionValid;
    return {exists:true,unsupported:false,state:String(raw.state||''),enabled,triggerEnabled,lastRunTime:String(raw.lastRunTime||''),lastResult:Number(raw.lastResult),nextRunTime,missedRuns:Math.max(0,Number(raw.missedRuns)||0),execute:String(raw.execute||''),arguments:String(raw.arguments||''),workingDirectory:working,actionValid,scheduleActive,error:''};
  }catch(error){return {exists:false,unsupported:false,state:'',enabled:false,triggerEnabled:false,lastRunTime:'',lastResult:null,nextRunTime:'',missedRuns:0,execute:'',arguments:'',workingDirectory:'',actionValid:false,scheduleActive:false,error:String(error?.stderr||error?.message||error).trim()}}
}
function printPdfMaintenanceTaskDiagnostics(task){
  if(task.unsupported){console.log('PDF maintenance Task Scheduler: unavailable on this platform');return}
  if(!task.exists){console.log(`PDF maintenance Task Scheduler: NOT INSTALLED${task.error?` (${task.error})`:''}`);return}
  console.log(`PDF maintenance Task Scheduler: ${task.state||'unknown'}; enabled=${task.enabled?'yes':'no'}; trigger enabled=${task.triggerEnabled?'yes':'no'}; schedule active=${task.scheduleActive?'yes':'no'}; action=${task.actionValid?'OK':'MISMATCH'}`);
  console.log(`  Last Run Time: ${task.lastRunTime||'never'}`);console.log(`  Last Result: ${taskResultLabel(task.lastResult)}`);console.log(`  Next Run Time: ${task.nextRunTime||'not scheduled'}`);console.log(`  Missed Runs: ${task.missedRuns}`);
}

async function printDoctor({allowUnreadyScheduledTask=false}={}){
  await init();const [{probe,diagnostics},pdfRuntime,task]=await Promise.all([diagnoseIndex({freshProbe:true}),verifyNodePdfJsRuntime(),pdfMaintenanceTaskDiagnostics()]);
  const nodeRuntime=privateNodeRuntimeInfoSync({verifyHash:process.platform==='win32'}),executable=probe.everythingExecutable||await findEverythingExecutable(await loadConfig());
  console.log(`Document Bridge v${BRIDGE_VERSION}`);console.log(`Runtime: ${RUNTIME_ROOT}`);console.log(`Node: ${process.versions.node} (pinned private LTS ${BRIDGE_NODE_VERSION})`);console.log(`Node executable: ${nodeRuntime.actualPath}`);if(nodeRuntime.sha256)console.log(`Node SHA-256: ${nodeRuntime.sha256} (verified)`);console.log(`ES: ${probe.esVersion||'unknown'} (${probe.esPath})`);console.log(`Everything: ${probe.everythingVersion||'unknown'}${probe.instance?` [instance ${probe.instance}]`:''}`);console.log(`Everything background executable: ${executable}`);console.log(`Windows Preview Handler host: ${(await existsFile(NATIVE_PREVIEW_HOST))?'OK':'MISSING'}`);console.log(`Interactive PDF extractor: OK (PDF.js ${pdfRuntime.version||'unknown'} ${pdfRuntime.runtime} build, ${pdfRuntime.mode}; Node canvas rendering ${pdfRuntime.canvasRenderingAvailable?'available':'not bundled/not required'})`);console.log('Search scope: complete Everything index + local AcroForm/PDF text supplement');
  printPdfMaintenanceTaskDiagnostics(task);
  console.log(`Files visible in Everything: ${diagnostics.fileCount===null?'ERROR':diagnostics.fileCount}`);console.log(`Files with indexed content: ${diagnostics.indexedContentCount===null?'ERROR':diagnostics.indexedContentCount}`);console.log(`ES UTF-8 JSON parsing: ${diagnostics.fileCount>0?(diagnostics.sampleOk?'OK':'FAILED'):'not tested'}`);if(diagnostics.error)console.log(`ES error: ${diagnostics.error}`);
  if(!task.unsupported&&!allowUnreadyScheduledTask&&(!task.exists||!task.scheduleActive)){const e=new Error('PDF maintenance Task Scheduler diagnostics failed.');e.code='PDF_MAINTENANCE_TASK_DIAGNOSTICS_FAILED';throw e}
  if(diagnostics.error||(diagnostics.fileCount>0&&!diagnostics.sampleOk)){const e=new Error('Everything/ES diagnostics failed.');e.code='INDEX_DIAGNOSTICS_FAILED';throw e}
  if(diagnostics.fileCount===0)console.log('WARNING: Everything currently sees no files. The website will mirror that empty Everything index.');
}
async function writeInstallSummary(){
  const token=await ensureToken(),config=await loadConfig();let probe=null,diagnostics={fileCount:null,indexedContentCount:null,sampleOk:false,error:''},everythingExecutable='',nodeRuntime=null;
  try{nodeRuntime=privateNodeRuntimeInfoSync({verifyHash:process.platform==='win32'})}catch(error){nodeRuntime={actualPath:process.execPath,sha256:'',error:String(error?.message||error)}}
  const task=await pdfMaintenanceTaskDiagnostics();
  try{const data=await diagnoseIndex({freshProbe:true});probe=data.probe;diagnostics=data.diagnostics;everythingExecutable=probe.everythingExecutable||await findEverythingExecutable(config)}catch{}
  const taskLines=task.unsupported?['PDF maintenance task: unavailable on this platform']:task.exists?[`PDF maintenance task: ${task.state||'unknown'}; enabled=${task.enabled?'yes':'no'}; trigger enabled=${task.triggerEnabled?'yes':'no'}; schedule active=${task.scheduleActive?'yes':'no'}; action=${task.actionValid?'OK':'MISMATCH'}`,`   Last Run Time: ${task.lastRunTime||'never'}`,`   Last Result: ${taskResultLabel(task.lastResult)}`,`   Next Run Time: ${task.nextRunTime||'not scheduled'}`,`   Missed Runs: ${task.missedRuns}`]:[`PDF maintenance task: NOT INSTALLED${task.error?` (${task.error})`:''}`];
  const lines=['NETUNIM DOCUMENT BRIDGE - INSTALLATION LOG','==========================================','','הקוד שצריך להדביק באתר:',token,'','באתר: Ctrl+K -> קבצים במחשב -> הדבק את הקוד שלמעלה פעם אחת.','',`Bridge version: ${BRIDGE_VERSION}`,`Runtime: ${RUNTIME_ROOT}`,`Node version: ${process.versions.node} (pinned ${BRIDGE_NODE_VERSION})`,`Node executable: ${nodeRuntime.actualPath||process.execPath}`,`Node SHA-256: ${nodeRuntime.sha256?`${nodeRuntime.sha256} (verified)`:nodeRuntime.error||'not checked'}`,`Local address: http://127.0.0.1:${BRIDGE_PORT}`,probe?`Everything: ${probe.everythingVersion||'unknown'}`:'Everything: status unavailable',`Everything background executable: ${everythingExecutable||'(not found)'}`,`Windows Preview Handler host: ${await existsFile(NATIVE_PREVIEW_HOST)?'OK':'MISSING'}`,'',...taskLines,'','Search scope: COMPLETE EVERYTHING INDEX + INTERACTIVE PDF SUPPLEMENT','The Bridge no longer maintains a separate folder allowlist. Whatever Everything indexes is searchable from the website.','Interactive AcroForm PDFs are additionally parsed locally with the bundled PDF.js legacy runtime for Node so field values and logical page text remain searchable even when the Windows PDF iFilter omits/reorders them.','','בדיקת האינדקס:',`   files visible in Everything: ${diagnostics.fileCount??'ERROR'}`,`   files with indexed content: ${diagnostics.indexedContentCount??'ERROR'}`,`   ES UTF-8 JSON parsing: ${diagnostics.fileCount>0?(diagnostics.sampleOk?'OK':'FAILED'):'not tested'}`,...(diagnostics.error?[`   error: ${diagnostics.error}`]:[]),'',`Runtime log: ${LOG_PATH}`,`Console log: ${path.join(APP_ROOT,'bridge-console.log')}`,`ES installer log: ${path.join(APP_ROOT,'install-es.log')}`,`Node installer log: ${path.join(APP_ROOT,'install-node.log')}`,'','ES is forced to UTF-8 output (-cp 65001) and Unicode argv parsing (-argv).','Search text is passed after -- to preserve Everything quotes; -max-results limits only the IPC viewport.','Everything.exe is started automatically in background mode (-startup) when needed. No search window is opened.','Searches use the same Everything index/database as the Everything UI and merge a local cached supplement only for interactive AcroForm PDFs.','Office previews use the Windows system IPreviewHandler associated with the file extension (the same preview layer Everything normally uses).','Files and extracted content stay on this computer and are not uploaded to the website or Supabase.'];
  await fs.writeFile(SUMMARY_PATH,lines.join('\r\n')+'\r\n','utf8');console.log(SUMMARY_PATH);
}

async function main(){
  if(process.platform==='win32')privateNodeRuntimeInfoSync();
  const arg=process.argv[2]||'';
  if(arg==='--init'){await init();return}if(arg==='--doctor'){await printDoctor({allowUnreadyScheduledTask:process.argv.slice(3).includes('--allow-unready-task')});return}if(arg==='--ensure-everything'){await init();const probe=await probeEverything({fresh:true,autoStart:true});console.log(`${probe.everythingVersion||'unknown'} ${probe.everythingExecutable||''}`.trim());return}if(arg==='--refresh-pdf-index'){
    if(process.send)process.on('message',message=>{if(message?.type==='stop-pdf-maintenance'){pdfMaintenanceStopRequested=true;pdfFormIndexRefreshAbortController?.abort()}});
    await init();await probeEverything({fresh:true,autoStart:true});
    const extraArgs=process.argv.slice(3),maxArg=extraArgs.find(value=>/^--max-files=\d+$/.test(String(value)));
    const maxChanged=maxArg?Math.max(0,Number(maxArg.split('=')[1])||0):PDF_FORM_MAINTENANCE_MAX_FILES;
    let lastPrinted=0;
    const result=await withFileLock(PDF_FORM_MAINTENANCE_LOCK_PATH,()=>refreshPdfFormIndex({maxChanged,force:extraArgs.includes('--force'),reason:extraArgs.includes('--force')?'manual':'scheduled',onProgress:progress=>{
      if(process.send)void sendMaintenanceIpc({type:'pdf-maintenance-progress',progress});
      if(progress.phase==='start'){console.log(`Interactive PDF index scan: ${progress.pdfCount} PDF files, ${progress.changed} need inspection; processing ${progress.selected} now.`);return}
      if(progress.processed===progress.selected||progress.processed-lastPrinted>=4){lastPrinted=progress.processed;console.log(`Interactive PDF index progress: ${progress.processed}/${progress.selected}`)}
    }}),{waitMs:process.send?0:10000,staleMs:60*60*1000});
    await sendMaintenanceIpc({type:'pdf-maintenance-result',result});
    if(process.send&&process.connected)process.disconnect();
    if(result.skipped){console.log('Interactive PDF maintenance is not due yet.');return}
    console.log(`Interactive PDF index: ${result.cached} inspected cache entries, ${result.interactive} interactive PDFs, ${result.processed}/${result.changed} inspected now, ${result.pending} pending, ${result.failed} failed`);return
  }if(arg==='--print-token'){console.log(await ensureToken());return}if(arg==='--stop-existing'){await stopExisting();return}if(arg==='--check-running'){await checkRunning();return}if(arg==='--write-install-summary'){await writeInstallSummary();return}
  if(process.platform!=='win32')throw new Error('Document Bridge is intended for Windows.');
  await init();server=http.createServer((req,res)=>{handle(req,res).catch(async error=>{await appendLog(`UNHANDLED ${error?.stack||error}`);try{res.writeHead(500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(safeError(error)))}catch{}})});server.on('error',error=>appendLog(`SERVER ${error?.code||''} ${error?.message||error}`));server.listen(BRIDGE_PORT,'127.0.0.1',()=>{appendLog(`START ${BRIDGE_SERVICE} v${BRIDGE_VERSION} node=${process.versions.node} on 127.0.0.1:${BRIDGE_PORT}`);probeEverything({fresh:true,autoStart:true}).then(probe=>appendLog(`EVERYTHING_READY version=${probe.everythingVersion} instance=${probe.instance||'(default)'}`)).catch(error=>appendLog(`EVERYTHING_BACKGROUND_START_FAILED ${error?.code||'ERROR'} ${error?.message||error}`))});
}
main().catch(async error=>{await appendLog(`FATAL ${error?.stack||error}`);console.error(error?.message||error);process.exitCode=1});
