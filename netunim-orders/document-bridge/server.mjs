import {createWindowsProcessControl} from './windows-process-control.mjs';
import {createBridgeReplacementCommand} from './bridge-replacement-command.mjs';
import {createBridgeRuntimeFiles} from './bridge-runtime-files.mjs';
import {createPdfMaintenanceTaskDiagnostics} from './pdf-maintenance-task-diagnostics.mjs';
import {createBridgeInstallationDiagnostics} from './bridge-installation-diagnostics.mjs';
import {createPdfInventoryReconciliation} from './pdf-inventory-reconciliation.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {
  BRIDGE_PORT,BRIDGE_SERVICE,BRIDGE_VERSION,DEFAULT_RESULT_LIMIT,MAX_RESULTS,RECENT_RESULT_LIMIT,RESULT_TTL_MS,
  buildContentMatchInfo,buildDocumentQuery,buildEsContentPreviewArgs,buildEsCountArgs,buildEsRawSearchArgs,buildEsRecentFilesArgs,buildEsSearchArgs,compareDocumentRows,contentSearchMatches,documentExtension,documentFileTypeIncludesPdf,mergeDocumentResults,normalizeContentSearchOptions,normalizeDocumentFileType,normalizeDocumentSearchMode,normalizeDocumentSort,normalizeSearchScopePath,normalizeSearchText,
  officePreviewKind,structuredPreviewKind,parseEsContentPreview,parseEsCount,parseEsJson,
} from './lib.mjs';
import {buildPdfFormMatchAnchors,extractInteractivePdfText,PDF_FORM_MAX_BYTES,verifyNodePdfJsRuntime} from './pdf_form_index.mjs';
import {pdfMaintenanceInventoryPlan,pdfMaintenanceRunLimits} from './pdf-index-policy.mjs';
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
const processControl=createWindowsProcessControl();
const {waitForProcessExit,processAlive,forceStopProcessTree}=processControl;
const bridgeRuntime=createBridgeRuntimeFiles();
const {APP_ROOT,TOKEN_PATH}=bridgeRuntime.paths;
const {appendLog,readJsonFile,writeJsonFile,ensureToken,loadConfig,saveConfig,init,privateNodeRuntimeInfoSync}=bridgeRuntime;
const RUNTIME_ROOT=fileURLToPath(new URL('.',import.meta.url));
const PDF_MAINTENANCE_TASK_NAME='NetunimDocumentBridgePdfMaintenance';
const PDF_FORM_INDEX_PATH=path.join(APP_ROOT,'pdf-form-index.json');
const PDF_FORM_INDEX_JOURNAL_PATH=path.join(APP_ROOT,'pdf-form-index.journal.jsonl');

const NATIVE_PREVIEW_HOST=path.join(RUNTIME_ROOT,'NetunimPreviewHost.exe');
const documentResults=createDocumentResultRegistry({
  clock:{now:Date.now,ttlMs:RESULT_TTL_MS},
  identity:{next:()=>crypto.randomUUID()},
  files:{stat:fullPath=>fs.stat(fullPath)},
});

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
const pdfReconciliation=createPdfInventoryReconciliation({inventory:pdfInventory,
  index:{entries:pdfFormIndex,key:pdfIndexKey,fingerprint:pdfIndexFingerprint,append:appendPdfIndexJournal,view:()=>({pdfCount:pdfFormIndexInventoryCount}),publish:({pending,pdfCount})=>{pdfFormIndexPending=pending;pdfFormIndexInventoryCount=pdfCount}},
  policy:{PDF_FORM_DETECTION_REVISION,PDF_FORM_SEARCH_TEXT_REVISION},
});
async function rebuildPdfFormIndexBacklog(options={}){return pdfReconciliation.rebuild(options)}

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









const {stopExisting,checkRunning}=createBridgeReplacementCommand({
  token:{path:TOKEN_PATH,read:(file,encoding)=>fs.readFile(file,encoding)},listener:{port:BRIDGE_PORT,request:http.request},
  processes:processControl,runtime:{now:Date.now,setTimeout,log:appendLog},
});

const taskDiagnostics=createPdfMaintenanceTaskDiagnostics({root:APP_ROOT,taskName:PDF_MAINTENANCE_TASK_NAME});
const {printDoctor,writeInstallSummary}=createBridgeInstallationDiagnostics({
  runtime:{host:process,root:RUNTIME_ROOT,previewHost:NATIVE_PREVIEW_HOST,files:bridgeRuntime},
  search:{diagnoseIndex,findEverythingExecutable},pdf:{verifyNodePdfJsRuntime,...taskDiagnostics},
});

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
