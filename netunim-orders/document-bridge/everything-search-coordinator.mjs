import {BRIDGE_VERSION,MAX_RESULTS,DEFAULT_RESULT_LIMIT,RECENT_RESULT_LIMIT,buildEsCountArgs,buildEsRawSearchArgs,parseEsCount,parseEsJson,buildEsSearchArgs,buildEsRecentFilesArgs,mergeDocumentResults,compareDocumentRows,normalizeDocumentSearchMode,normalizeContentSearchOptions,normalizeSearchScopePath,normalizeDocumentSort,normalizeDocumentFileType,buildDocumentQuery,documentFileTypeIncludesPdf} from './lib.mjs';
import {createDocumentSearch} from './search-owner.mjs';
import {contentQueryRequiresVerification,contentSearchMatches,parseEsContentRows} from './lib.mjs';
import {setImmediate} from 'node:timers/promises';

// Coordinates scoped Everything retries, diagnostics and the established search
// owner. It does not own process construction, registry paths or HTTP admission.
export function createEverythingSearchCoordinator({configuration,session,process,pdf,publication,audit}) {
  const loadConfig=configuration.load,probeEverything=options=>session.probe(options),findEverythingExecutable=config=>session.executable(config);
  const runEs=(...args)=>process.run(...args),everythingSession=session,appendLog=audit.write;
  const pruneResults=publication.prune,publicResult=publication.publish;
  const preparePdfFormIndexForSearch=pdf.prepare,searchPdfFormIndex=pdf.search;
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
    const config=await loadConfig();
    let probe=await probeEverything({fresh:freshProbe,autoStart:true});
    if(!probe.everythingExecutable){try{probe={...probe,everythingExecutable:await findEverythingExecutable(config)}}catch{}}
    let fileCount=null,indexedContentCount=null,sampleOk=false,error='';
    try{
      fileCount=await countIndex(probe,config,'*');
      indexedContentCount=await countIndex(probe,config,'is-indexed-property:content');
      if(fileCount>0)sampleOk=(await sampleIndex(probe,config)).length>0;
    }catch(err){error=String(err?.message||err)}
    return {config,probe,diagnostics:{fileCount,indexedContentCount,sampleOk,error}};
  }
  async function runEverythingJson(buildArgs,{signal=null,decode=parseEsJson,deadline=Infinity}={}){
    signal?.throwIfAborted();
    const config=await loadConfig();
    let probe=await probeEverything({autoStart:true});
    const started=Date.now();
    const runSearch=currentProbe=>{
      signal?.throwIfAborted();
      return runEs(currentProbe.esPath,buildArgs(config,currentProbe),{timeout:Math.max(1,Math.min(config.searchTimeoutMs+5000,Math.ceil(deadline-performance.now()))),signal});
    };
    let output;
    try{output=await runSearch(probe)}catch(error){
      signal?.throwIfAborted();
      if(error?.exitCode!==8)throw error;
      everythingSession.invalidate();
      probe=await probeEverything({fresh:true,autoStart:true});
      output=await runSearch(probe);
    }
    signal?.throwIfAborted();
    return {rows:decode(output.stdout),elapsedMs:Date.now()-started};
  }
  async function searchEverything(request){
    const build=(read,config,probe)=>buildEsSearchArgs({...read,timeoutMs:config.searchTimeoutMs,instance:probe.instance});
    if(request.mode!=='content'||!contentQueryRequiresVerification(request.query,request.contentSearch))return runEverythingJson((config,probe)=>build(request,config,probe),{signal:request.signal});
    const config=await loadConfig(),started=performance.now(),deadline=started+config.searchTimeoutMs+5000;
    const wanted=request.offset+request.limit,rows=[],verifiedPaths=new Set();
    let candidateOffset=0,partial=false,batchSize=100;
    // Candidates retain native sorting and scope. Filter before applying the
    // result offset; a rejected candidate must never consume a result slot.
    while(rows.length<wanted){
      request.signal?.throwIfAborted();
      if(candidateOffset>=MAX_RESULTS||performance.now()>=deadline){partial=true;break}
      const limit=Math.min(batchSize,MAX_RESULTS-candidateOffset);
      let result;
      try{
        result=await runEverythingJson((current,probe)=>build({...request,offset:candidateOffset,limit},current,probe),{decode:parseEsContentRows,deadline,signal:request.signal});
      }catch(error){
        request.signal?.throwIfAborted();
        if(error?.code==='ES_OUTPUT_LIMIT'&&error?.name!=='AbortError'){
          // Retain the same native cursor and deadline. Failed output is never
          // decoded or published; successful batches alone advance the cursor.
          if(limit===1)throw Object.assign(new Error('תוכן מסמך יחיד חורג ממגבלת האימות של החיפוש. אפשר לצמצם לתיקייה או לסוג קבצים אחר.'),{code:'ES_CONTENT_TOO_LARGE'});
          batchSize=Math.max(1,Math.floor(limit/2));continue;
        }
        // Only an expected deadline after verified progress can yield a partial
        // page. Decode/extraction/IPC failures cannot certify this result set.
        if(error?.code!=='ES_TIMEOUT'||error?.name==='AbortError'||!rows.length)throw error;
        partial=true;break;
      }
      for(const {content,...row} of result.rows){
        const identity=row.fullPath.toLocaleLowerCase('en-US');
        const matches=!verifiedPaths.has(identity)&&contentSearchMatches(content,request.query,request.contentSearch);
        // Give disconnects, sibling reads and health requests an event-loop turn
        // after each bounded document verification, before granting any result.
        await setImmediate();
        request.signal?.throwIfAborted();
        if(matches){
          verifiedPaths.add(identity);rows.push(row);
        }
        if(performance.now()>=deadline){partial=true;break}
        if(rows.length>=wanted)break;
      }
      candidateOffset+=result.rows.length;
      if(partial||result.rows.length<limit)break;
    }
    return {rows:rows.slice(request.offset,wanted),elapsedMs:Math.round(performance.now()-started),partial};
  }
  const documentSearch=createDocumentSearch({
    everything:{
      search:searchEverything,
      recent:request=>runEverythingJson((config,probe)=>buildEsRecentFilesArgs({...request,timeoutMs:config.searchTimeoutMs,instance:probe.instance}),{signal:request.signal}),
    },
    pdf:{
      prepare:preparePdfFormIndexForSearch,
      search:(plan,limit)=>searchPdfFormIndex(plan.query,plan.contentSearch,plan.scopePath,limit,plan.sort)
    },
    ordering:{merge:mergeDocumentResults,compare:compareDocumentRows},
    publication:{prune:pruneResults,publish:publicResult},
    audit:{write:appendLog},
  },{bridgeVersion:BRIDGE_VERSION,maxResults:MAX_RESULTS,defaultLimit:DEFAULT_RESULT_LIMIT,recentLimit:RECENT_RESULT_LIMIT});
  async function searchDocuments(query,limit,mode='everything',contentSearch={},scopePath='',offset=0,sort={},fileType='all',signal=null){
    const normalizedMode=normalizeDocumentSearchMode(mode),normalizedContentSearch=normalizeContentSearchOptions(contentSearch),normalizedScope=normalizeSearchScopePath(scopePath),normalizedSort=normalizeDocumentSort(sort),normalizedFileType=normalizeDocumentFileType(fileType),everythingQuery=buildDocumentQuery(query,normalizedMode,normalizedContentSearch,normalizedFileType);
    if(!everythingQuery){
      const e=new Error(normalizedMode==='content'?'יש להקליד לפחות שני תווים לחיפוש בתוכן הקבצים.':'יש להקליד לפחות תו אחד לחיפוש ב-Everything.');
      e.code='QUERY_TOO_SHORT';
      throw e
    }
    return documentSearch.search({
      query,
      mode:normalizedMode,
      contentSearch:normalizedContentSearch,
      scopePath:normalizedScope,
      sort:normalizedSort,
      fileType:normalizedFileType,
      everythingQuery,
      includePdf:documentFileTypeIncludesPdf(normalizedFileType),
      signal
    },limit,offset);
  }
  async function recentDocuments(limit,scopePath='',fileType='all',signal=null){
  return documentSearch.recent({scopePath:normalizeSearchScopePath(scopePath),fileType:normalizeDocumentFileType(fileType),signal},limit);
}
  return {diagnoseIndex,searchDocuments,recentDocuments,runtime:documentSearch};
}
