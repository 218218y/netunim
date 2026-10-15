import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {
  BRIDGE_PORT,BRIDGE_SERVICE,BRIDGE_VERSION,BRIDGE_NODE_VERSION,BRIDGE_NODE_WIN_X64_SHA256,assertBridgeNodeVersion,DEFAULT_ALLOWED_ORIGINS,DEFAULT_RESULT_LIMIT,MAX_RESULTS,RECENT_RESULT_LIMIT,RESULT_TTL_MS,
  buildContentMatchInfo,buildDocumentQuery,buildEsContentPreviewArgs,buildEsCountArgs,buildEsRawSearchArgs,buildEsRecentFilesArgs,buildEsSearchArgs,compareDocumentRows,contentSearchMatches,documentExtension,documentFileTypeIncludesPdf,mergeDocumentResults,normalizeContentSearchOptions,normalizeDocumentFileType,normalizeDocumentSearchMode,normalizeDocumentSort,normalizeSearchScopePath,normalizeSearchText,
  officePreviewKind,structuredPreviewKind,parseEsContentPreview,parseEsCount,parseEsJson,
} from './lib.mjs';
import {buildPdfFormMatchAnchors,extractInteractivePdfText,PDF_FORM_MAX_BYTES,verifyNodePdfJsRuntime} from './pdf_form_index.mjs';
import {pdfIndexNeedsInspection,pdfMaintenanceInventoryPlan,pdfMaintenanceRunLimits} from './pdf-index-policy.mjs';
import {createPdfIndexReader} from './pdf-index-reader.mjs';
import {createPdfIndexFilePlatform} from './pdf-index-file-platform.mjs';
import {createPdfIndexWriter} from './pdf-index-writer.mjs';
import {createPdfIndexWritePlatform} from './pdf-index-write-platform.mjs';
import {createPdfInventory} from './pdf-inventory.mjs';
import {createPdfMaintenanceOperation} from './pdf-maintenance-operation.mjs';
import {readPdfMaintenanceMetadata} from './pdf-maintenance-platform.mjs';
import {createEverythingInventorySource} from './everything-inventory-source.mjs';
import {createFileLockOwner} from './file-lock-owner.mjs';
import {createFileLockPlatform} from './file-lock-platform.mjs';
import {createMaintenanceProcessOwner,runMaintenanceWorker} from './maintenance-process-owner.mjs';
import {createMaintenanceProcessPlatform,createMaintenanceWorkerPlatform} from './maintenance-process-platform.mjs';
import {createDocumentBridgeRoutes} from './http-routes.mjs';
import {createDocumentPreview,isTextPreview,trimPreviewText} from './preview-content.mjs';
import {createPreviewTextCache} from './preview-text-cache.mjs';
import {createPreviewFilePlatform} from './preview-file-platform.mjs';
import {createNativePreviewSession} from './native-preview-session.mjs';
import {createNativePreviewHostPlatform} from './native-preview-platform.mjs';
import {createDocumentBridgeHttpHandler,documentBridgeErrorResponse as safeError} from './http-handler.mjs';
import {createDocumentSearch} from './search-owner.mjs';
import {createEverythingSession} from './everything-session.mjs';
import {createEverythingProcess} from './everything-process.mjs';
import {createEverythingDiscovery} from './everything-discovery.mjs';
import {createEverythingProcessPlatform,createEverythingDiscoveryPlatform} from './everything-process-platform.mjs';
import {createDocumentResultRegistry} from './result-registry.mjs';
import {createPdfPreviewOperation} from './pdf-preview-operation.mjs';
import {createPdfExtractionProcess} from './pdf-extraction-process.mjs';
import {createPdfExtractionPlatform} from './pdf-extraction-platform.mjs';

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

const NATIVE_PREVIEW_HOST=path.join(RUNTIME_ROOT,'NetunimPreviewHost.exe');
const documentResults=createDocumentResultRegistry({
  clock:{now:Date.now,ttlMs:RESULT_TTL_MS},
  identity:{next:()=>crypto.randomUUID()},
  files:{stat:fullPath=>fs.stat(fullPath)},
});
// Shutdown joins accepted search/probe/reprobe and maintenance work before the
// installer may replace runtime files. This is a caller deadline, not a retry.
const SHUTDOWN_REQUEST_TIMEOUT_MS=120000;
const PREVIEW_TEXT_CACHE_TTL_MS=10*60*1000;
const PREVIEW_TEXT_CACHE_MAX=24;
const previewTextCache=createPreviewTextCache({clock:Date.now,ttlMs:PREVIEW_TEXT_CACHE_TTL_MS,maxEntries:PREVIEW_TEXT_CACHE_MAX});
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
let server=null;
let pdfFormIndexLoaded=false,pdfFormIndexLastRefresh=0,pdfFormIndexPending=0,pdfFormIndexInventoryCount=0,shuttingDown=false,pdfFormIndexSignature='';
let pdfMaintenanceStopRequested=false;

const pdfFormIndex=new Map();

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

const everythingProcesses=createEverythingProcess(createEverythingProcessPlatform({root:APP_ROOT}));
const everythingDiscovery=createEverythingDiscovery(createEverythingDiscoveryPlatform({root:APP_ROOT,processes:everythingProcesses}));
async function whereEs(){return everythingDiscovery.es()}

async function runEs(file,args,options={}){return everythingProcesses.es(file,args,options)}




async function findEverythingExecutable(config){return everythingDiscovery.executable(config)}


const everythingSession=createEverythingSession({
  configuration:{load:loadConfig,save:saveConfig},
  discovery:{es:whereEs,executable:findEverythingExecutable},
  process:{run:runEs,start:(file,args)=>everythingProcesses.start(file,args)},
  runtime:{now:Date.now,wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))},
  audit:{write:appendLog},
});
async function probeEverything(options={}){return everythingSession.probe(options)}

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

function pruneResults(){documentResults.prune()}
function publicResult(row,{query='',mode='everything',contentSearch={}}={}){return documentResults.publish(row,{query:String(query||''),mode:normalizeDocumentSearchMode(mode),contentSearch:normalizeContentSearchOptions(contentSearch)})}
async function runEverythingJson(buildArgs,{signal=null}={}){
  const config=await loadConfig();let probe=await probeEverything({autoStart:true});const started=Date.now();
  const runSearch=currentProbe=>runEs(currentProbe.esPath,buildArgs(config,currentProbe),{timeout:config.searchTimeoutMs+5000,signal});
  let output;
  try{output=await runSearch(probe)}catch(error){
    if(error?.exitCode!==8)throw error;
    everythingSession.invalidate();probe=await probeEverything({fresh:true,autoStart:true});output=await runSearch(probe);
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
const fileLocks=createFileLockOwner({...createFileLockPlatform({root:APP_ROOT}),
  clock:()=>performance.now(),wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
});
const withFileLock=(lockPath,task,options)=>fileLocks.run(lockPath,task,options);
async function activePdfMaintenanceLock(){return fileLocks.isHeld(PDF_FORM_MAINTENANCE_LOCK_PATH)}
const manualMaintenance=createMaintenanceProcessOwner({
  host:createMaintenanceProcessPlatform({executable:process.execPath,script:fileURLToPath(import.meta.url),cwd:APP_ROOT,isHeld:activePdfMaintenanceLock}),
  timers:{setTimeout,clearTimeout},now:()=>new Date().toISOString(),log:appendLog,
});
async function sendMaintenanceIpc(message){
  if(!process.send||!process.connected)return;
  await new Promise(resolve=>process.send(message,()=>resolve()));
}
async function pdfMaintenanceStatus(){
  const maintenance=await readJsonFile(PDF_FORM_MAINTENANCE_PATH,{});
  let {manual,cancelable}=manualMaintenance.view(),scheduled=false;
  if(!manual?.running){scheduled=await activePdfMaintenanceLock();({manual,cancelable}=manualMaintenance.view())}
  const running=!!manual?.running||scheduled;
  return {ok:true,bridgeVersion:BRIDGE_VERSION,running,source:manual?.running?'manual':running?'scheduled':'',cancelable,stopRequested:!!manual?.running&&!!manual.stopRequested,phase:manual?.running?manual.phase||'starting':'',progress:manual?.running?manual.progress||null:null,lastRun:!manual?.running?manual?.result||null:null,lastError:!manual?.running?manual?.error||'':'',lastResult:maintenance.lastResult||null,lastFailure:maintenance.lastFailure||''};
}
async function startManualPdfMaintenance(){
  await manualMaintenance.start();return pdfMaintenanceStatus();
}
async function stopManualPdfMaintenance(){
  await manualMaintenance.stop();return pdfMaintenanceStatus();
}
const pdfIndexFiles=createPdfIndexFilePlatform({snapshotPath:PDF_FORM_INDEX_PATH,journalPath:PDF_FORM_INDEX_JOURNAL_PATH});
const pdfIndexReader=createPdfIndexReader({files:pdfIndexFiles,normalizeEntry:normalizePdfIndexEntry});
const pdfIndexSignature=()=>pdfIndexFiles.signature();
const pdfIndexWriter=createPdfIndexWriter({reader:pdfIndexReader,
  files:createPdfIndexWritePlatform({snapshotPath:PDF_FORM_INDEX_PATH,journalPath:PDF_FORM_INDEX_JOURNAL_PATH}),
  lock:{run:work=>withFileLock(PDF_FORM_INDEX_LOCK_PATH,work)},serializeEntry:serializePdfIndexEntry,
  publish:(candidate,phase)=>publishPdfIndexCandidate(candidate,{metadata:phase==='compact'}),now:Date.now,
});
function publishPdfIndexCandidate(candidate,{metadata=true}={}){
  // Publication is synchronous and follows complete, stable candidate decoding.
  // Retire match text for both removed and retained PDF entries on disk reload.
  for(const key of pdfFormIndex.keys())previewTextCache.invalidate(key);
  pdfFormIndex.clear();
  for(const [key,entry] of candidate.entries){pdfFormIndex.set(key,entry);previewTextCache.invalidate(key)}
  if(metadata){pdfFormIndexPending=candidate.pending;pdfFormIndexInventoryCount=candidate.pdfCount;pdfFormIndexLastRefresh=candidate.updatedAt}
  pdfFormIndexLoaded=true;pdfFormIndexSignature=candidate.signature;
}
async function readPdfIndexFiles(){publishPdfIndexCandidate(await pdfIndexReader.read())}
async function loadPdfFormIndex(){
  if(pdfFormIndexLoaded&&pdfFormIndexSignature===await pdfIndexSignature())return;
  await withFileLock(PDF_FORM_INDEX_LOCK_PATH,async()=>{if(!pdfFormIndexLoaded||pdfFormIndexSignature!==await pdfIndexSignature())await readPdfIndexFiles()});
}
async function appendPdfIndexJournal(records){
  await pdfIndexWriter.append(records);
}
async function compactPdfFormIndex({pending=pdfFormIndexPending,pdfCount=pdfFormIndexInventoryCount}={}){
  await pdfIndexWriter.compact({pending,pdfCount});
}
const pdfInventory=createPdfInventory({...createEverythingInventorySource({loadConfig,probeEverything,runEs}),
  isStopping:()=>shuttingDown||pdfMaintenanceStopRequested,
},{pageSize:PDF_FORM_INDEX_PAGE_SIZE});
async function listEverythingPdfs(options={}){return pdfInventory.read(options)}
async function rebuildPdfFormIndexBacklog({signal=null,full=false,modifiedSince=''}={}){
  const rows=await listEverythingPdfs({signal,modifiedSince:full?'':modifiedSince,verifyComplete:full});
  pdfInventory.assertActive(signal);
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
    for(const [key,entry] of [...pdfFormIndex.entries()])if(!seen.has(key)){removalRecords.push({op:'remove',fullPath:entry.fullPath});removed+=1}
  }
  if(removalRecords.length)await appendPdfIndexJournal(removalRecords);
  pdfInventory.assertActive(signal);
  pdfFormIndexPending=changed.length;pdfFormIndexInventoryCount=full?rows.length:pdfFormIndexInventoryCount;
  return {pdfCount:rows.length,changed:changed.length,removed,rows:changed};
}
const pdfMaintenanceOperation=createPdfMaintenanceOperation({
  index:{load:loadPdfFormIndex,entries:pdfFormIndex,view:()=>({pending:pdfFormIndexPending,pdfCount:pdfFormIndexInventoryCount}),
    publishPending:pending=>{pdfFormIndexPending=pending},append:appendPdfIndexJournal,serialize:serializePdfIndexEntry,compact:compactPdfFormIndex},
  inventory:{rebuild:rebuildPdfFormIndexBacklog},
  extraction:{read:extractInteractivePdfText,stat:fullPath=>fs.stat(fullPath),fields:normalizePdfFormFields},
  metadata:{read:()=>readPdfMaintenanceMetadata(PDF_FORM_MAINTENANCE_PATH),write:record=>writeJsonFile(PDF_FORM_MAINTENANCE_PATH,record)},
  policy:{plan:pdfMaintenanceInventoryPlan,limits:{PDF_FORM_MAINTENANCE_MAX_FILES,PDF_FORM_MAINTENANCE_MAX_MS,PDF_FORM_MAINTENANCE_INTERVAL_MS,PDF_FORM_RECONCILE_INTERVAL_MS,PDF_FORM_RETRY_MS,PDF_FORM_MAX_BYTES,PDF_FORM_DETECTION_REVISION,PDF_FORM_SEARCH_TEXT_REVISION,PDF_FORM_GEOMETRY_REVISION}},
  runtime:{now:Date.now,cpuUsage:previous=>process.cpuUsage(previous),isStopping:()=>shuttingDown||pdfMaintenanceStopRequested,setTimeout,clearTimeout},
  audit:{write:appendLog},
});
async function refreshPdfFormIndex(options={}){return pdfMaintenanceOperation.refresh(options)}

async function preparePdfFormIndexForSearch(){
  try{await loadPdfFormIndex()}catch(error){await appendLog(`PDF_FORM_INDEX_LOAD_FAILED ${error?.message||error}`);return {partial:true}}
  return {partial:!pdfFormIndexLastRefresh||pdfFormIndexPending>0};
}
const pdfExtractionProcesses=createPdfExtractionProcess({
  ...createPdfExtractionPlatform({executable:process.execPath,script:path.join(RUNTIME_ROOT,'pdf-extract-worker.mjs'),cwd:APP_ROOT}),
  runtime:{setTimeout,clearTimeout},
});
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
const pdfPreviewOperation=createPdfPreviewOperation({
  index:{load:loadPdfFormIndex,get:key=>pdfFormIndex.get(key),append:entry=>appendPdfIndexJournal([{op:'upsert',entry:serializePdfIndexEntry(entry)}])},
  extraction:{read:(fullPath,options)=>pdfExtractionProcesses.read(fullPath,options)},
  paths:{basename:fullPath=>path.win32.basename(fullPath),dirname:fullPath=>path.win32.dirname(fullPath)},
  presentation:{trim:trimPreviewText,fields:normalizePdfFormFields},
  policy:{detectionRevision:PDF_FORM_DETECTION_REVISION,searchTextRevision:PDF_FORM_SEARCH_TEXT_REVISION,geometryRevision:PDF_FORM_GEOMETRY_REVISION},
  audit:{write:appendLog},
});
async function supplementalPdfData(row,stat){return pdfPreviewOperation.read(row,stat)}
const documentSearch=createDocumentSearch({
  everything:{
    search:request=>runEverythingJson((config,probe)=>buildEsSearchArgs({...request,timeoutMs:config.searchTimeoutMs,instance:probe.instance})),
    recent:request=>runEverythingJson((config,probe)=>buildEsRecentFilesArgs({...request,timeoutMs:config.searchTimeoutMs,instance:probe.instance})),
  },
  pdf:{prepare:preparePdfFormIndexForSearch,search:(plan,limit)=>searchPdfFormIndex(plan.query,plan.contentSearch,plan.scopePath,limit,plan.sort)},
  ordering:{merge:mergeDocumentResults,compare:compareDocumentRows},
  publication:{prune:pruneResults,publish:publicResult},
  audit:{write:appendLog},
},{bridgeVersion:BRIDGE_VERSION,maxResults:MAX_RESULTS,defaultLimit:DEFAULT_RESULT_LIMIT,recentLimit:RECENT_RESULT_LIMIT});
async function searchDocuments(query,limit,mode='everything',contentSearch={},scopePath='',offset=0,sort={},fileType='all'){
  const normalizedMode=normalizeDocumentSearchMode(mode),normalizedContentSearch=normalizeContentSearchOptions(contentSearch),normalizedScope=normalizeSearchScopePath(scopePath),normalizedSort=normalizeDocumentSort(sort),normalizedFileType=normalizeDocumentFileType(fileType),everythingQuery=buildDocumentQuery(query,normalizedMode,normalizedContentSearch,normalizedFileType);
  if(!everythingQuery){const e=new Error(normalizedMode==='content'?'יש להקליד לפחות שני תווים לחיפוש בתוכן הקבצים.':'יש להקליד לפחות תו אחד לחיפוש ב-Everything.');e.code='QUERY_TOO_SHORT';throw e}
  return documentSearch.search({query,mode:normalizedMode,contentSearch:normalizedContentSearch,scopePath:normalizedScope,sort:normalizedSort,fileType:normalizedFileType,everythingQuery,includePdf:documentFileTypeIncludesPdf(normalizedFileType)},limit,offset);
}
async function recentDocuments(limit,scopePath='',fileType='all'){
  return documentSearch.recent({scopePath:normalizeSearchScopePath(scopePath),fileType:normalizeDocumentFileType(fileType)},limit);
}

async function resolveResult(id){return documentResults.resolve(id)}

const previewFiles=createPreviewFilePlatform();
const nativePreviewSession=createNativePreviewSession({
  host:createNativePreviewHostPlatform({hostPath:NATIVE_PREVIEW_HOST,applicationRoot:APP_ROOT,
    processes:{waitForExit:waitForProcessExit,alive:processAlive,forceStopTree:forceStopProcessTree},log:appendLog}),
  timers:{setTimeout,clearTimeout},log:appendLog,
});
const nativePreviewCommand=(command,args=[],timeoutMs=6000)=>nativePreviewSession.command(command,args,timeoutMs);
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
async function moveNativePreview(geometry){const box=normalizePreviewGeometry(geometry);if(!nativePreviewSession.isRunning())return {ok:true,visible:false};await nativePreviewCommand('MOVE',[box.x,box.y,box.width,box.height],2500);return {ok:true,visible:true}}
async function hideNativePreview(){if(!nativePreviewSession.isRunning())return {ok:true};try{await nativePreviewCommand('HIDE',[],2500)}catch{}return {ok:true}}
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
async function readEverythingContentPreview(fullPath){
  try{
    const config=await loadConfig(),probe=await probeEverything({autoStart:true});
    const args=buildEsContentPreviewArgs({fullPath,timeoutMs:config.searchTimeoutMs,instance:probe.instance});
    const {stdout}=await runEs(probe.esPath,args,{timeout:config.searchTimeoutMs+5000});
    const content=parseEsContentPreview(stdout);if(!content)return null;return trimPreviewText(content);
  }catch(error){await appendLog(`PREVIEW_CONTENT_FAILED path=${JSON.stringify(fullPath)} error=${JSON.stringify(String(error?.message||error))}`);return null}
}
async function loadSearchablePreviewText(row,stat){
  const extension=documentExtension(row.fullPath);
  let data=null;
  if(isTextPreview(extension)){const direct=await previewFiles.readText(row.fullPath);data={...direct,source:'file'}}
  else if(extension==='pdf'){
    const [everythingText,pdfData]=await Promise.all([readEverythingContentPreview(row.fullPath),supplementalPdfData(row,stat)]);
    if(pdfData?.text)data={...pdfData,source:'pdfjs-acroform'};else if(everythingText?.text)data={...everythingText,source:'everything-content'};
  }else{const extracted=await readEverythingContentPreview(row.fullPath);if(extracted)data={...extracted,source:'everything-content'}}
  return data;
}
function searchablePreviewText(row,stat){
  const extension=documentExtension(row.fullPath),fingerprint=`${Number(stat.size)||0}:${Number(stat.mtimeMs)||0}${extension==='pdf'?`:pdf-search-${PDF_FORM_SEARCH_TEXT_REVISION}:geometry-${PDF_FORM_GEOMETRY_REVISION}`:''}`;
  return previewTextCache.read(row.fullPath,fingerprint,()=>loadSearchablePreviewText(row,stat));
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
const documentPreview=createDocumentPreview({
  resolve:async id=>{const {row,stat}=await resolveResult(id),metadata=previewMetadata(row,stat);return {
    mode:row.mode,metadata,officeKind:officePreviewKind(metadata.extension)||'',structuredKind:structuredPreviewKind(metadata.extension)||'',
  }},
  files:previewFiles,indexedText:readEverythingContentPreview,
});
const previewDocument=documentPreview.document,readBinaryPreview=documentPreview.file;

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
  const target=String(fullPath||'').toLocaleLowerCase('en-US'),invalidatedIds=documentResults.invalidate(fullPath);
  previewTextCache.invalidate(target);await pdfPreviewOperation.invalidate(fullPath);await loadPdfFormIndex();if(pdfFormIndex.has(target))await appendPdfIndexJournal([{op:'remove',fullPath}]);
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

async function documentBridgeStatus(){
  const {probe,diagnostics}=await diagnoseIndex({freshProbe:true});
  let pdfIndexError='';try{await loadPdfFormIndex()}catch(error){pdfIndexError=String(error?.message||error)}
  const interactivePdfCount=[...pdfFormIndex.values()].filter(entry=>entry.hasForm&&!entry.failed).length,maintenance=await readJsonFile(PDF_FORM_MAINTENANCE_PATH,{});
  return {ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,esVersion:probe.esVersion,everythingVersion:probe.everythingVersion,everythingExecutable:probe.everythingExecutable||'',instance:probe.instance,index:{fileCount:diagnostics.fileCount,indexedContentCount:diagnostics.indexedContentCount,sampleOk:diagnostics.sampleOk,error:[diagnostics.error,pdfIndexError].filter(Boolean).join('; '),interactivePdfCount,inspectedPdfCount:pdfFormIndex.size,interactivePdfPending:pdfFormIndexPending,interactivePdfUpdatedAt:pdfFormIndexLastRefresh?new Date(pdfFormIndexLastRefresh).toISOString():'',maintenanceLastAttemptAt:maintenance.lastAttemptAt||'',maintenanceLastSuccessfulAt:maintenance.lastSuccessfulAt||'',maintenanceLastFailureAt:maintenance.lastFailureAt||'',maintenanceLastFailure:maintenance.lastFailure||'',maintenanceLastResult:maintenance.lastResult||null}};
}
function bridgeHealth(){return {ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,pid:process.pid}}
async function warmDocumentSearch(){const probe=await probeEverything({autoStart:true});return {ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,everythingVersion:probe.everythingVersion,instance:probe.instance}}
async function prepareShutdown(){
  shuttingDown=true;
  previewTextCache.dispose();
  const searchDrain=documentSearch.dispose(),sessionDrain=everythingSession.dispose(),discoveryDrain=everythingDiscovery.dispose(),processDrain=everythingProcesses.dispose(),pdfDrain=pdfMaintenanceOperation.dispose(),pdfPreviewDrain=pdfPreviewOperation.dispose(),pdfProcessDrain=pdfExtractionProcesses.dispose();
  documentResults.dispose();
  await Promise.all([searchDrain,sessionDrain,discoveryDrain,processDrain,pdfDrain,pdfPreviewDrain,pdfProcessDrain,manualMaintenance.dispose(),nativePreviewSession.dispose()]);
  return {ok:true,pid:process.pid};
}
function finishShutdown(){
  setTimeout(()=>{server?.close(async()=>{await appendLog('STOP graceful shutdown complete');process.exitCode=0})},20);
  setTimeout(()=>{process.exit(0)},2500).unref?.();
}
function createRequestHandler(){
  const routes=createDocumentBridgeRoutes({
    service:{status:documentBridgeStatus,warm:warmDocumentSearch},
    maintenance:{status:pdfMaintenanceStatus,start:startManualPdfMaintenance,stop:stopManualPdfMaintenance},
    search:{selectFolder:selectSearchFolder,recent:recentDocuments,search:searchDocuments},
    preview:{document:previewDocument,matches:previewMatches,file:readBinaryPreview},
    nativePreview:{open:openNativePreview,move:moveNativePreview,hide:hideNativePreview},
    files:{open:openDocument,reveal:revealDocument,delete:deleteDocument},
    shutdown:{prepare:prepareShutdown,afterResponse:finishShutdown},
  });
  return createDocumentBridgeHttpHandler({loadConfig,readToken:ensureToken,routes,health:bridgeHealth,appendLog});
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
  const response=await loopbackRequest('/shutdown',{method:'POST',token,timeoutMs:SHUTDOWN_REQUEST_TIMEOUT_MS});if(response.statusCode!==200){const e=new Error(`Existing Document Bridge refused shutdown (HTTP ${response.statusCode}).`);e.code='SHUTDOWN_FAILED';throw e}
  const portDeadline=Date.now()+3500;let portClosed=false;while(Date.now()<portDeadline){await new Promise(r=>setTimeout(r,120));try{await loopbackRequest('/health',{timeoutMs:300})}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code))){portClosed=true;break}}}
  if(listenerPid&&!(await waitForProcessExit(listenerPid,1500))){await appendLog(`INSTALL_STOP_FORCE pid=${listenerPid} reason=${JSON.stringify(portClosed?'listener-closed-process-still-running':'shutdown-timeout')}`);await forceStopProcessTree(listenerPid);if(!(await waitForProcessExit(listenerPid,2500))){const e=new Error(`Existing Document Bridge process ${listenerPid} could not be terminated.`);e.code='SHUTDOWN_PROCESS_STUCK';throw e}}
  try{await loopbackRequest('/health',{timeoutMs:500});const e=new Error('Existing Document Bridge listener is still active after shutdown.');e.code='SHUTDOWN_TIMEOUT';throw e}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code)))return;throw error}
}

function taskResultLabel(value){
  const numeric=Number(value);if(!Number.isFinite(numeric))return 'unknown';const unsigned=numeric>>>0;return `${Math.trunc(numeric)} (0x${unsigned.toString(16).toUpperCase().padStart(8,'0')})`;
}
async function pdfMaintenanceTaskDiagnostics(){
  if(process.platform!=='win32')return {exists:false,unsupported:true,state:'',enabled:false,triggerEnabled:false,lastRunTime:'',lastResult:null,nextRunTime:'',missedRuns:0,actionExecuteValid:false,actionRunnerValid:false,actionWorkingDirectoryValid:false,actionValid:false,scheduleActive:false,error:''};
  const expectedRunner=path.join(APP_ROOT,'run_pdf_maintenance.ps1');
  const script=[
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)',
    `$task=Get-ScheduledTask -TaskName '${PDF_MAINTENANCE_TASK_NAME}' -ErrorAction Stop`,
    `$info=Get-ScheduledTaskInfo -TaskName '${PDF_MAINTENANCE_TASK_NAME}' -ErrorAction Stop`,
    '$action=@($task.Actions)[0]',
    '$triggers=@($task.Triggers)',
    '$expectedRunner=[string]$env:NETUNIM_TASK_EXPECTED_RUNNER',
    "$expectedWorkingDirectory=([System.IO.Path]::GetFullPath([string]$env:NETUNIM_TASK_EXPECTED_WORKDIR)).TrimEnd('\\')",
    '$executeLeaf=[System.IO.Path]::GetFileName([string]$action.Execute)',
    '$arguments=[string]$action.Arguments',
    "$registeredWorkingDirectory=([string]$action.WorkingDirectory).TrimEnd('\\')",
    "$actualWorkingDirectory=if($registeredWorkingDirectory){([System.IO.Path]::GetFullPath($registeredWorkingDirectory)).TrimEnd('\\')}else{''}",
    "$executeValid=($executeLeaf -ieq 'powershell.exe')",
    '$runnerValid=($expectedRunner.Length -gt 0 -and $arguments.IndexOf($expectedRunner,[System.StringComparison]::OrdinalIgnoreCase) -ge 0)',
    '$workingDirectoryValid=($actualWorkingDirectory -ieq $expectedWorkingDirectory)',
    "$lastRun=if($info.LastRunTime.Year -gt 1900){$info.LastRunTime.ToString('o')}else{''}",
    "$nextRun=if($info.NextRunTime.Year -gt 1900){$info.NextRunTime.ToString('o')}else{''}",
    "$triggerEnabled=(@($triggers | Where-Object { $_.Enabled -ne $false }).Count -gt 0)",
    "[pscustomobject]@{state=[string]$task.State;enabled=([string]$task.State -ne 'Disabled');triggerEnabled=[bool]$triggerEnabled;lastRunTime=$lastRun;lastResult=[int64]$info.LastTaskResult;nextRunTime=$nextRun;missedRuns=[int]$info.NumberOfMissedRuns;actionExecuteValid=[bool]$executeValid;actionRunnerValid=[bool]$runnerValid;actionWorkingDirectoryValid=[bool]$workingDirectoryValid}|ConvertTo-Json -Compress",
  ].join(';');
  const env={...process.env,NETUNIM_TASK_EXPECTED_RUNNER:expectedRunner,NETUNIM_TASK_EXPECTED_WORKDIR:APP_ROOT};
  try{
    const {stdout}=await execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{encoding:'utf8',windowsHide:true,timeout:8000,maxBuffer:1024*1024,env});
    const raw=JSON.parse(String(stdout||'').trim());
    const actionExecuteValid=raw.actionExecuteValid===true,actionRunnerValid=raw.actionRunnerValid===true,actionWorkingDirectoryValid=raw.actionWorkingDirectoryValid===true;
    const actionValid=actionExecuteValid&&actionRunnerValid&&actionWorkingDirectoryValid;
    const enabled=raw.enabled===true,triggerEnabled=raw.triggerEnabled===true,nextRunTime=String(raw.nextRunTime||''),scheduleActive=enabled&&triggerEnabled&&!!nextRunTime&&actionValid;
    return {exists:true,unsupported:false,state:String(raw.state||''),enabled,triggerEnabled,lastRunTime:String(raw.lastRunTime||''),lastResult:Number(raw.lastResult),nextRunTime,missedRuns:Math.max(0,Number(raw.missedRuns)||0),actionExecuteValid,actionRunnerValid,actionWorkingDirectoryValid,actionValid,scheduleActive,error:''};
  }catch(error){return {exists:false,unsupported:false,state:'',enabled:false,triggerEnabled:false,lastRunTime:'',lastResult:null,nextRunTime:'',missedRuns:0,actionExecuteValid:false,actionRunnerValid:false,actionWorkingDirectoryValid:false,actionValid:false,scheduleActive:false,error:String(error?.stderr||error?.message||error).trim()}}
}
function taskActionDiagnosticLabel(task){
  if(task.actionValid)return 'OK';
  return `MISMATCH (execute=${task.actionExecuteValid?'ok':'bad'}; runner=${task.actionRunnerValid?'ok':'bad'}; cwd=${task.actionWorkingDirectoryValid?'ok':'bad'})`;
}
function printPdfMaintenanceTaskDiagnostics(task){
  if(task.unsupported){console.log('PDF maintenance Task Scheduler: unavailable on this platform');return}
  if(!task.exists){console.log(`PDF maintenance Task Scheduler: NOT INSTALLED${task.error?` (${task.error})`:''}`);return}
  console.log(`PDF maintenance Task Scheduler: ${task.state||'unknown'}; enabled=${task.enabled?'yes':'no'}; trigger enabled=${task.triggerEnabled?'yes':'no'}; schedule active=${task.scheduleActive?'yes':'no'}; action=${taskActionDiagnosticLabel(task)}`);
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
  const taskLines=task.unsupported?['PDF maintenance task: unavailable on this platform']:task.exists?[`PDF maintenance task: ${task.state||'unknown'}; enabled=${task.enabled?'yes':'no'}; trigger enabled=${task.triggerEnabled?'yes':'no'}; schedule active=${task.scheduleActive?'yes':'no'}; action=${taskActionDiagnosticLabel(task)}`,`   Last Run Time: ${task.lastRunTime||'never'}`,`   Last Result: ${taskResultLabel(task.lastResult)}`,`   Next Run Time: ${task.nextRunTime||'not scheduled'}`,`   Missed Runs: ${task.missedRuns}`]:[`PDF maintenance task: NOT INSTALLED${task.error?` (${task.error})`:''}`];
  const lines=['NETUNIM DOCUMENT BRIDGE - INSTALLATION LOG','==========================================','','הקוד שצריך להדביק באתר:',token,'','באתר: Ctrl+K -> קבצים במחשב -> הדבק את הקוד שלמעלה פעם אחת.','',`Bridge version: ${BRIDGE_VERSION}`,`Runtime: ${RUNTIME_ROOT}`,`Node version: ${process.versions.node} (pinned ${BRIDGE_NODE_VERSION})`,`Node executable: ${nodeRuntime.actualPath||process.execPath}`,`Node SHA-256: ${nodeRuntime.sha256?`${nodeRuntime.sha256} (verified)`:nodeRuntime.error||'not checked'}`,`Local address: http://127.0.0.1:${BRIDGE_PORT}`,probe?`Everything: ${probe.everythingVersion||'unknown'}`:'Everything: status unavailable',`Everything background executable: ${everythingExecutable||'(not found)'}`,`Windows Preview Handler host: ${await existsFile(NATIVE_PREVIEW_HOST)?'OK':'MISSING'}`,'',...taskLines,'','Search scope: COMPLETE EVERYTHING INDEX + INTERACTIVE PDF SUPPLEMENT','The Bridge no longer maintains a separate folder allowlist. Whatever Everything indexes is searchable from the website.','Interactive AcroForm PDFs are additionally parsed locally with the bundled PDF.js legacy runtime for Node so field values and logical page text remain searchable even when the Windows PDF iFilter omits/reorders them.','','בדיקת האינדקס:',`   files visible in Everything: ${diagnostics.fileCount??'ERROR'}`,`   files with indexed content: ${diagnostics.indexedContentCount??'ERROR'}`,`   ES UTF-8 JSON parsing: ${diagnostics.fileCount>0?(diagnostics.sampleOk?'OK':'FAILED'):'not tested'}`,...(diagnostics.error?[`   error: ${diagnostics.error}`]:[]),'',`Runtime log: ${LOG_PATH}`,`Console log: ${path.join(APP_ROOT,'bridge-console.log')}`,`ES installer log: ${path.join(APP_ROOT,'install-es.log')}`,`Node installer log: ${path.join(APP_ROOT,'install-node.log')}`,'','ES is forced to UTF-8 output (-cp 65001) and Unicode argv parsing (-argv).','Search text is passed after -- to preserve Everything quotes; -max-results limits only the IPC viewport.','Everything.exe is started automatically in background mode (-startup) when needed. No search window is opened.','Searches use the same Everything index/database as the Everything UI and merge a local cached supplement only for interactive AcroForm PDFs.','Office previews use the Windows system IPreviewHandler associated with the file extension (the same preview layer Everything normally uses).','Files and extracted content stay on this computer and are not uploaded to the website or Supabase.'];
  await fs.writeFile(SUMMARY_PATH,lines.join('\r\n')+'\r\n','utf8');console.log(SUMMARY_PATH);
}

async function main(){
  if(process.platform==='win32')privateNodeRuntimeInfoSync();
  const arg=process.argv[2]||'';
  if(arg==='--init'){await init();return}if(arg==='--doctor'){await printDoctor({allowUnreadyScheduledTask:process.argv.slice(3).includes('--allow-unready-task')});return}if(arg==='--ensure-everything'){await init();const probe=await probeEverything({fresh:true,autoStart:true});console.log(`${probe.everythingVersion||'unknown'} ${probe.everythingExecutable||''}`.trim());return}if(arg==='--refresh-pdf-index'){
    return runMaintenanceWorker(createMaintenanceWorkerPlatform({requestStop:()=>{pdfMaintenanceStopRequested=true;pdfMaintenanceOperation.stop()}}),async()=>{
    await init();await probeEverything({fresh:true,autoStart:true});
    const extraArgs=process.argv.slice(3),maxArg=extraArgs.find(value=>/^--max-files=\d+$/.test(String(value))),manual=extraArgs.includes('--force');
    const {maxChanged,maxMs}=pdfMaintenanceRunLimits({manual,requestedMaxFiles:maxArg?Number(maxArg.split('=')[1]):null,scheduledMaxFiles:PDF_FORM_MAINTENANCE_MAX_FILES,scheduledMaxMs:PDF_FORM_MAINTENANCE_MAX_MS});
    let lastPrinted=0;
    const result=await withFileLock(PDF_FORM_MAINTENANCE_LOCK_PATH,()=>refreshPdfFormIndex({maxChanged,maxMs,force:manual,reason:manual?'manual':'scheduled',onProgress:progress=>{
      if(process.send)void sendMaintenanceIpc({type:'pdf-maintenance-progress',progress});
      if(progress.phase==='start'){console.log(`Interactive PDF index scan: ${progress.pdfCount} PDF files, ${progress.changed} need inspection; processing ${progress.selected} now.`);return}
      if(progress.processed===progress.selected||progress.processed-lastPrinted>=4){lastPrinted=progress.processed;console.log(`Interactive PDF index progress: ${progress.processed}/${progress.selected}`)}
    }}),{waitMs:process.send?0:10000});
    await sendMaintenanceIpc({type:'pdf-maintenance-result',result});
    if(result.skipped){console.log('Interactive PDF maintenance is not due yet.');return}
    console.log(`Interactive PDF index: ${result.cached} inspected cache entries, ${result.interactive} interactive PDFs, ${result.processed}/${result.changed} inspected now, ${result.pending} pending, ${result.failed} failed`);
    });
  }if(arg==='--print-token'){console.log(await ensureToken());return}if(arg==='--stop-existing'){await stopExisting();return}if(arg==='--check-running'){await checkRunning();return}if(arg==='--write-install-summary'){await writeInstallSummary();return}
  if(process.platform!=='win32')throw new Error('Document Bridge is intended for Windows.');
  await init();const handle=createRequestHandler();server=http.createServer((req,res)=>{handle(req,res).catch(async error=>{await appendLog(`UNHANDLED ${error?.stack||error}`);try{res.writeHead(500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(safeError(error)))}catch{}})});server.on('error',error=>appendLog(`SERVER ${error?.code||''} ${error?.message||error}`));server.listen(BRIDGE_PORT,'127.0.0.1',()=>{appendLog(`START ${BRIDGE_SERVICE} v${BRIDGE_VERSION} node=${process.versions.node} on 127.0.0.1:${BRIDGE_PORT}`);probeEverything({fresh:true,autoStart:true}).then(probe=>appendLog(`EVERYTHING_READY version=${probe.everythingVersion} instance=${probe.instance||'(default)'}`)).catch(error=>appendLog(`EVERYTHING_BACKGROUND_START_FAILED ${error?.code||'ERROR'} ${error?.message||error}`))});
}
main().catch(async error=>{await appendLog(`FATAL ${error?.stack||error}`);console.error(error?.message||error);process.exitCode=1});
