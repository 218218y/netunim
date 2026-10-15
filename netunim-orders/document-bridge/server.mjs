import {createDocumentOperations} from './document-operations.mjs';
import {createBridgeService} from './bridge-service.mjs';
import {createPdfIndexCoordinator} from './pdf-index-coordinator.mjs';
import {createEverythingSearchCoordinator} from './everything-search-coordinator.mjs';
import {createWindowsProcessControl} from './windows-process-control.mjs';
import {createBridgeReplacementCommand} from './bridge-replacement-command.mjs';
import {createBridgeRuntimeFiles} from './bridge-runtime-files.mjs';
import {createPdfMaintenanceTaskDiagnostics} from './pdf-maintenance-task-diagnostics.mjs';
import {createBridgeInstallationDiagnostics} from './bridge-installation-diagnostics.mjs';

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {BRIDGE_PORT,RESULT_TTL_MS,normalizeContentSearchOptions,normalizeDocumentSearchMode} from './lib.mjs';
import {extractInteractivePdfText,PDF_FORM_MAX_BYTES,verifyNodePdfJsRuntime} from './pdf_form_index.mjs';
import {pdfMaintenanceInventoryPlan} from './pdf-index-policy.mjs';

import {createPdfMaintenanceOperation} from './pdf-maintenance-operation.mjs';
import {readPdfMaintenanceMetadata} from './pdf-maintenance-platform.mjs';

import {createFileLockOwner} from './file-lock-owner.mjs';
import {createFileLockPlatform} from './file-lock-platform.mjs';
import {createMaintenanceProcessOwner} from './maintenance-process-owner.mjs';
import {createMaintenanceProcessPlatform} from './maintenance-process-platform.mjs';
import {createDocumentBridgeRoutes} from './http-routes.mjs';
import {trimPreviewText} from './preview-content.mjs';
import {createPreviewTextCache} from './preview-text-cache.mjs';
import {createPreviewFilePlatform} from './preview-file-platform.mjs';
import {createNativePreviewSession} from './native-preview-session.mjs';
import {createNativePreviewHostPlatform} from './native-preview-platform.mjs';
import {createDocumentBridgeHttpHandler} from './http-handler.mjs';

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
const {appendLog,writeJsonFile,ensureToken,loadConfig,saveConfig}=bridgeRuntime;
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

function pruneResults(){documentResults.prune()}
function publicResult(row,{query='',mode='everything',contentSearch={}}={}){return documentResults.publish(row,{query:String(query||''),mode:normalizeDocumentSearchMode(mode),contentSearch:normalizeContentSearchOptions(contentSearch)})}
const fileLocks=createFileLockOwner({
  ...createFileLockPlatform({root:APP_ROOT}),
  clock:()=>performance.now(),
  wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
});
const withFileLock=(lockPath,task,options)=>fileLocks.run(lockPath,task,options);
async function activePdfMaintenanceLock(){return fileLocks.isHeld(PDF_FORM_MAINTENANCE_LOCK_PATH)}
const manualMaintenance=createMaintenanceProcessOwner({
  host:createMaintenanceProcessPlatform({executable:process.execPath,script:fileURLToPath(import.meta.url),cwd:APP_ROOT,isHeld:activePdfMaintenanceLock}),
  timers:{setTimeout,clearTimeout},
  now:()=>new Date().toISOString(),
  log:appendLog,
});
const pdfIndexRuntime=createPdfIndexCoordinator({
  files:{PDF_FORM_INDEX_PATH,PDF_FORM_INDEX_JOURNAL_PATH,PDF_FORM_INDEX_LOCK_PATH},
  locking:{withFileLock},
  everything:{loadConfig,probeEverything,runEs},
  cache:previewTextCache,
  runtime:{isStopping:()=>service.isStopping(),log:appendLog},
  policy:{PDF_FORM_INDEX_PAGE_SIZE,PDF_FORM_DETECTION_REVISION,PDF_FORM_SEARCH_TEXT_REVISION},
});
const {load:loadPdfFormIndex,entries:pdfFormIndex,append:appendPdfIndexJournal,serialize:serializePdfIndexEntry}=pdfIndexRuntime.index;
const {fields:normalizePdfFormFields}=pdfIndexRuntime.forms;
const {prepare:preparePdfFormIndexForSearch,search:searchPdfFormIndex}=pdfIndexRuntime.search;
const searchRuntime=createEverythingSearchCoordinator({
  configuration:{load:loadConfig},
  session:{probe:probeEverything,executable:findEverythingExecutable,invalidate:()=>everythingSession.invalidate()},
  process:{run:runEs},
  pdf:{prepare:preparePdfFormIndexForSearch,search:searchPdfFormIndex},
  publication:{prune:pruneResults,publish:publicResult},
  audit:{write:appendLog},
});
const {diagnoseIndex,searchDocuments,recentDocuments,runtime:documentSearch}=searchRuntime;

const pdfMaintenanceOperation=createPdfMaintenanceOperation({
  index:pdfIndexRuntime.index,
  inventory:pdfIndexRuntime.inventory,
  extraction:{read:extractInteractivePdfText,stat:fullPath=>fs.stat(fullPath),fields:normalizePdfFormFields},
  metadata:{read:()=>readPdfMaintenanceMetadata(PDF_FORM_MAINTENANCE_PATH),write:record=>writeJsonFile(PDF_FORM_MAINTENANCE_PATH,record)},
  policy:{
    plan:pdfMaintenanceInventoryPlan,
    limits:{
      PDF_FORM_MAINTENANCE_MAX_FILES,
      PDF_FORM_MAINTENANCE_MAX_MS,
      PDF_FORM_MAINTENANCE_INTERVAL_MS,
      PDF_FORM_RECONCILE_INTERVAL_MS,
      PDF_FORM_RETRY_MS,
      PDF_FORM_MAX_BYTES,
      PDF_FORM_DETECTION_REVISION,
      PDF_FORM_SEARCH_TEXT_REVISION,
      PDF_FORM_GEOMETRY_REVISION
    }
  },
  runtime:{now:Date.now,cpuUsage:previous=>process.cpuUsage(previous),isStopping:()=>service.isStopping(),setTimeout,clearTimeout},
  audit:{write:appendLog},
});
const pdfExtractionProcesses=createPdfExtractionProcess({
  ...createPdfExtractionPlatform({executable:process.execPath,script:path.join(RUNTIME_ROOT,'pdf-extract-worker.mjs'),cwd:APP_ROOT}),
  runtime:{setTimeout,clearTimeout},
});
const pdfPreviewOperation=createPdfPreviewOperation({
  index:{
    load:loadPdfFormIndex,
    get:key=>pdfFormIndex.get(key),
    append:entry=>appendPdfIndexJournal([{op:'upsert',entry:serializePdfIndexEntry(entry)}])
  },
  extraction:{read:(fullPath,options)=>pdfExtractionProcesses.read(fullPath,options)},
  paths:{basename:fullPath=>path.win32.basename(fullPath),dirname:fullPath=>path.win32.dirname(fullPath)},
  presentation:{trim:trimPreviewText,fields:normalizePdfFormFields},
  policy:{
    detectionRevision:PDF_FORM_DETECTION_REVISION,
    searchTextRevision:PDF_FORM_SEARCH_TEXT_REVISION,
    geometryRevision:PDF_FORM_GEOMETRY_REVISION
  },
  audit:{write:appendLog},
});

const previewFiles=createPreviewFilePlatform();
const nativePreviewSession=createNativePreviewSession({
  host:createNativePreviewHostPlatform({
    hostPath:NATIVE_PREVIEW_HOST,
    applicationRoot:APP_ROOT,
    processes:{waitForExit:waitForProcessExit,alive:processAlive,forceStopTree:forceStopProcessTree},
    log:appendLog
  }),
  timers:{setTimeout,clearTimeout},
  log:appendLog,
});
function createRequestHandler(){
  const routes=createDocumentBridgeRoutes({
    service:service.service,
    maintenance:service.maintenance,
    search:{selectFolder:documents.search.selectFolder,recent:recentDocuments,search:searchDocuments},
    preview:documents.preview,
    nativePreview:documents.native,
    files:documents.files,
    shutdown:service.shutdown,
  });
  return createDocumentBridgeHttpHandler({loadConfig,readToken:ensureToken,routes,health:service.health,appendLog});
}

const {stopExisting,checkRunning}=createBridgeReplacementCommand({
  token:{path:TOKEN_PATH,read:(file,encoding)=>fs.readFile(file,encoding)},
  listener:{port:BRIDGE_PORT,request:http.request},
  processes:processControl,
  runtime:{now:Date.now,setTimeout,log:appendLog},
});

const taskDiagnostics=createPdfMaintenanceTaskDiagnostics({root:APP_ROOT,taskName:PDF_MAINTENANCE_TASK_NAME});
const {printDoctor,writeInstallSummary}=createBridgeInstallationDiagnostics({
  runtime:{host:process,root:RUNTIME_ROOT,previewHost:NATIVE_PREVIEW_HOST,files:bridgeRuntime},
  search:{diagnoseIndex,findEverythingExecutable},
  pdf:{verifyNodePdfJsRuntime,...taskDiagnostics},
});

const documents=createDocumentOperations({
  registry:documentResults,
  preview:{cache:previewTextCache,files:previewFiles},
  pdf:{index:pdfIndexRuntime,preview:pdfPreviewOperation,policy:{PDF_FORM_SEARCH_TEXT_REVISION,PDF_FORM_GEOMETRY_REVISION}},
  native:nativePreviewSession,
  search:{loadConfig,probeEverything,runEs},
  platform:{host:{platform:process.platform,env:process.env},execFile,stat:fullPath=>fs.stat(fullPath)},
  audit:{write:appendLog},
});
const service=createBridgeService({
  files:bridgeRuntime,
  search:{probeEverything,diagnoseIndex,documentSearch,everythingSession,everythingDiscovery,everythingProcesses},
  pdf:{
    index:pdfIndexRuntime,
    operation:pdfMaintenanceOperation,
    preview:pdfPreviewOperation,
    extraction:pdfExtractionProcesses,
    paths:{PDF_FORM_MAINTENANCE_PATH,PDF_FORM_MAINTENANCE_LOCK_PATH},
    policy:{PDF_FORM_MAINTENANCE_MAX_FILES,PDF_FORM_MAINTENANCE_MAX_MS},
    withFileLock
  },
  documents:{documentCommands:documents.runtime,documentResults,previewTextCache,nativePreviewSession},
  maintenance:{manualMaintenance,activePdfMaintenanceLock},
  installation:{printDoctor,writeInstallSummary,stopExisting,checkRunning},
  listener:{host:process,createServer:(...args)=>http.createServer(...args),handler:createRequestHandler},
});
service.main().catch(async error=>{await appendLog(`FATAL ${error?.stack||error}`);console.error(error?.message||error);process.exitCode=1});
