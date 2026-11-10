import {BRIDGE_PORT,BRIDGE_SERVICE,BRIDGE_VERSION} from './lib.mjs';
import {runMaintenanceWorker} from './maintenance-process-owner.mjs';
import {createMaintenanceWorkerPlatform} from './maintenance-process-platform.mjs';
import {pdfMaintenanceRunLimits} from './pdf-index-policy.mjs';
import {documentBridgeDiagnosticCode,documentBridgeErrorResponse as safeError} from './http-handler.mjs';
import {joinDocumentReads} from './document-command-owner.mjs';

// Service state and HTTP/CLI lifetime compose explicit owners. Construction starts
// no listener, worker or provider; main is the only entry into platform boot.
export function createBridgeService({files,search,pdf,documents,maintenance,installation,listener}) {
  const {init,ensureToken,readJsonFile,privateNodeRuntimeInfoSync,appendLog}=files;
  const {probeEverything,diagnoseIndex,documentSearch,everythingSession,everythingDiscovery,everythingProcesses}=search;
  const pdfIndexRuntime=pdf.index,pdfMaintenanceOperation=pdf.operation,pdfPreviewOperation=pdf.preview,pdfExtractionProcesses=pdf.extraction;
  const {PDF_FORM_MAINTENANCE_PATH,PDF_FORM_MAINTENANCE_LOCK_PATH}=pdf.paths;
  const {PDF_FORM_MAINTENANCE_MAX_FILES,PDF_FORM_MAINTENANCE_MAX_MS}=pdf.policy;
  const loadPdfFormIndex=pdfIndexRuntime.index.load,withFileLock=pdf.withFileLock;
  const {manualMaintenance,activePdfMaintenanceLock}=maintenance;
  const {printDoctor,writeInstallSummary,stopExisting,checkRunning,waitForStartup}=installation;
  const {documentCommands,documentResults,previewTextCache,nativePreviewSession}=documents;
  const process=listener.host,http={createServer:listener.createServer},createRequestHandler=listener.handler;
  let server=null,shuttingDown=false,pdfMaintenanceStopRequested=false;
  async function pdfMaintenanceStatus(){
    const maintenance=await readJsonFile(PDF_FORM_MAINTENANCE_PATH,{});
    let {manual,cancelable}=manualMaintenance.view(),scheduled=false;
    if(!manual?.running){scheduled=await activePdfMaintenanceLock();({manual,cancelable}=manualMaintenance.view())}
    const running=!!manual?.running||scheduled;
    return {
      ok:true,
      bridgeVersion:BRIDGE_VERSION,
      running,
      source:manual?.running?'manual':running?'scheduled':'',
      cancelable,
      stopRequested:!!manual?.running&&!!manual.stopRequested,
      phase:manual?.running?manual.phase||'starting':'',
      progress:manual?.running?manual.progress||null:null,
      lastRun:!manual?.running?manual?.result||null:null,
      lastError:!manual?.running&&manual?.error?'עדכון אינדקס ה־PDF נכשל. בדוק את יומן המחבר במחשב.':'',
      lastResult:maintenance.lastResult||null,
      lastFailure:maintenance.lastFailure?'העדכון האחרון של אינדקס ה־PDF נכשל.':''
    };
  }
  async function startManualPdfMaintenance(){
  await manualMaintenance.start();return pdfMaintenanceStatus();
}
  async function stopManualPdfMaintenance(){
  await manualMaintenance.stop();return pdfMaintenanceStatus();
}
  async function sendMaintenanceIpc(message){
  if(!process.send||!process.connected)return;
  await new Promise(resolve=>process.send(message,()=>resolve()));
}
  async function refreshPdfFormIndex(options={}){return pdfMaintenanceOperation.refresh(options)}
  async function documentBridgeStatus(){
    const {probe,diagnostics}=await diagnoseIndex({freshProbe:true});
    let pdfIndexError='';
    try{await loadPdfFormIndex()}catch(error){
      pdfIndexError='לא ניתן לטעון את אינדקס ה־PDF המקומי.';
      await appendLog(`PDF_FORM_INDEX_LOAD_FAILED code=${documentBridgeDiagnosticCode(error)}`);
    }
    const pdfView=pdfIndexRuntime.view(),interactivePdfCount=pdfView.interactive,maintenance=await readJsonFile(PDF_FORM_MAINTENANCE_PATH,{});
    return {
      ok:true,
      service:BRIDGE_SERVICE,
      version:BRIDGE_VERSION,
      esVersion:probe.esVersion,
      everythingVersion:probe.everythingVersion,
      instance:probe.instance,
      index:{
        fileCount:diagnostics.fileCount,
        indexedContentCount:diagnostics.indexedContentCount,
        sampleOk:diagnostics.sampleOk,
        error:[diagnostics.error?'בדיקת האינדקס של Everything נכשלה.':null,pdfIndexError].filter(Boolean).join(' '),
        interactivePdfCount,
        inspectedPdfCount:pdfView.inspected,
        interactivePdfPending:pdfView.pending,
        interactivePdfUpdatedAt:pdfView.updatedAt?new Date(pdfView.updatedAt).toISOString():'',
        maintenanceLastAttemptAt:maintenance.lastAttemptAt||'',
        maintenanceLastSuccessfulAt:maintenance.lastSuccessfulAt||'',
        maintenanceLastFailureAt:maintenance.lastFailureAt||'',
        maintenanceLastFailure:maintenance.lastFailure?'העדכון האחרון של אינדקס ה־PDF נכשל.':'',
        maintenanceLastResult:maintenance.lastResult||null
      }
    };
  }
  function bridgeHealth(){return {ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,pid:process.pid}}
  async function warmDocumentSearch(){
    const probe=await probeEverything({autoStart:true});
    return {ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,everythingVersion:probe.everythingVersion,instance:probe.instance}
  }
  async function prepareShutdown(){
    shuttingDown=true;
    const commandDrain=documentCommands.dispose();
    previewTextCache.dispose();
    const searchDrain=documentSearch.dispose(),sessionDrain=everythingSession.dispose(),discoveryDrain=everythingDiscovery.dispose(),processDrain=everythingProcesses.dispose(),pdfDrain=pdfMaintenanceOperation.dispose(),pdfPreviewDrain=pdfPreviewOperation.dispose(),pdfProcessDrain=pdfExtractionProcesses.dispose();
    documentResults.dispose();
    await joinDocumentReads([
      commandDrain,
      searchDrain,
      sessionDrain,
      discoveryDrain,
      processDrain,
      pdfDrain,
      pdfPreviewDrain,
      pdfProcessDrain,
      manualMaintenance.dispose(),
      nativePreviewSession.dispose()
    ]);
    return {ok:true,pid:process.pid};
  }
  function finishShutdown(){
    setTimeout(()=>{server?.close(async()=>{await appendLog('STOP graceful shutdown complete');process.exitCode=0})},20);
    setTimeout(()=>{process.exit(0)},2500).unref?.();
  }
  async function main(){
    if(process.platform==='win32')privateNodeRuntimeInfoSync();
    const arg=process.argv[2]||'';
    if(arg==='--init'){await init();return}
    if(arg==='--doctor'){await printDoctor({allowUnreadyScheduledTask:process.argv.slice(3).includes('--allow-unready-task')});return}
    if(arg==='--ensure-everything'){
      await init();
      const probe=await probeEverything({fresh:true,autoStart:true});
      console.log(`${probe.everythingVersion||'unknown'} ${probe.everythingExecutable||''}`.trim());
      return
    }
    if(arg==='--refresh-pdf-index'){
    return runMaintenanceWorker(createMaintenanceWorkerPlatform({requestStop:()=>{pdfMaintenanceStopRequested=true;pdfMaintenanceOperation.stop()}}),async()=>{
        await init();
        await probeEverything({fresh:true,autoStart:true});
        const extraArgs=process.argv.slice(3),maxArg=extraArgs.find(value=>/^--max-files=\d+$/.test(String(value))),manual=extraArgs.includes('--force');
        const {maxChanged,maxMs}=pdfMaintenanceRunLimits({
          manual,
          requestedMaxFiles:maxArg?Number(maxArg.split('=')[1]):null,
          scheduledMaxFiles:PDF_FORM_MAINTENANCE_MAX_FILES,
          scheduledMaxMs:PDF_FORM_MAINTENANCE_MAX_MS
        });
        let lastPrinted=0;
        const result=await withFileLock(PDF_FORM_MAINTENANCE_LOCK_PATH,()=>refreshPdfFormIndex({
          maxChanged,
          maxMs,
          force:manual,
          reason:manual?'manual':'scheduled',
          onProgress:progress=>{
            if(process.send)void sendMaintenanceIpc({type:'pdf-maintenance-progress',progress});
            if(progress.phase==='start'){
              console.log(`Interactive PDF index scan: ${progress.pdfCount} PDF files, ${progress.changed} need inspection; processing ${progress.selected} now.`);
              return
            }
            if(progress.processed===progress.selected||progress.processed-lastPrinted>=4){lastPrinted=progress.processed;console.log(`Interactive PDF index progress: ${progress.processed}/${progress.selected}`)}
          }
        }),{waitMs:process.send?0:10000});
        await sendMaintenanceIpc({type:'pdf-maintenance-result',result});
        if(result.skipped){console.log('Interactive PDF maintenance is not due yet.');return}
        console.log(`Interactive PDF index: ${result.cached} inspected cache entries, ${result.interactive} interactive PDFs, ${result.processed}/${result.changed} inspected now, ${result.pending} pending, ${result.failed} failed`);
      });
  }
    if(arg==='--print-token'){console.log(await ensureToken());return}
    if(arg==='--stop-existing'){await stopExisting();return}
    if(arg==='--check-running'){
      await (process.argv.includes('--wait-for-startup')?waitForStartup():checkRunning());
      return;
    }
    if(arg==='--write-install-summary'){await writeInstallSummary();return}
    if(process.platform!=='win32')throw new Error('Document Bridge is intended for Windows.');
    await init();
    let handle, startup;
    server=http.createServer((req,res)=>{
      const response=handle?handle(req,res):startup.then(handler=>handler(req,res));
      void response.catch(async error=>{
        const data=safeError(error);
        await appendLog(`UNHANDLED code=${documentBridgeDiagnosticCode(error)}`);
        try{res.writeHead(500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}catch{}
      });
    });
    server.on('error',error=>appendLog(`SERVER code=${error?.code||'ERROR'}`));
    server.listen(BRIDGE_PORT,'127.0.0.1',()=>{
      // A concurrent startup that loses the port cannot initialize the registry.
      startup=Promise.resolve().then(createRequestHandler);
      void startup.then(handler=>{
        handle=handler;
        const cleanup=setInterval(()=>{void files.pruneLogs?.()},60*60*1000);
        cleanup.unref();
        appendLog(`START ${BRIDGE_SERVICE} v${BRIDGE_VERSION} node=${process.versions.node} on 127.0.0.1:${BRIDGE_PORT}`);
        probeEverything({fresh:true,autoStart:true}).then(()=>appendLog('EVERYTHING_READY')).catch(error=>appendLog(`EVERYTHING_BACKGROUND_START_FAILED code=${error?.code||'ERROR'}`))
      },async()=>{
        await appendLog('PAIRING_STARTUP_FAILED');
        server.close();
        process.exitCode=1;
      });
    });
  }
  return {
    service:{status:()=>documentCommands.run(documentBridgeStatus),warm:()=>documentCommands.run(warmDocumentSearch)},
    maintenance:{
      status:()=>documentCommands.run(pdfMaintenanceStatus),
      start:()=>documentCommands.run(startManualPdfMaintenance),
      stop:()=>documentCommands.run(stopManualPdfMaintenance)
    },
    health:bridgeHealth,
    shutdown:{prepare:prepareShutdown,afterResponse:finishShutdown},
    main,
    isStopping:()=>shuttingDown||pdfMaintenanceStopRequested,
  };
}
