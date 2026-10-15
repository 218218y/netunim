import {BRIDGE_VERSION,MAX_RESULTS,DEFAULT_RESULT_LIMIT,RECENT_RESULT_LIMIT,buildEsCountArgs,buildEsRawSearchArgs,parseEsCount,parseEsJson,buildEsSearchArgs,buildEsRecentFilesArgs,mergeDocumentResults,compareDocumentRows,normalizeDocumentSearchMode,normalizeContentSearchOptions,normalizeSearchScopePath,normalizeDocumentSort,normalizeDocumentFileType,buildDocumentQuery,documentFileTypeIncludesPdf} from './lib.mjs';
import {createDocumentSearch} from './search-owner.mjs';

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
  async function runEverythingJson(buildArgs,{signal=null}={}){
    const config=await loadConfig();
    let probe=await probeEverything({autoStart:true});
    const started=Date.now();
    const runSearch=currentProbe=>runEs(currentProbe.esPath,buildArgs(config,currentProbe),{timeout:config.searchTimeoutMs+5000,signal});
    let output;
    try{output=await runSearch(probe)}catch(error){
      if(error?.exitCode!==8)throw error;
      everythingSession.invalidate();
      probe=await probeEverything({fresh:true,autoStart:true});
      output=await runSearch(probe);
    }
    return {rows:parseEsJson(output.stdout),elapsedMs:Date.now()-started};
  }
  const documentSearch=createDocumentSearch({
    everything:{
      search:request=>runEverythingJson((config,probe)=>buildEsSearchArgs({...request,timeoutMs:config.searchTimeoutMs,instance:probe.instance})),
      recent:request=>runEverythingJson((config,probe)=>buildEsRecentFilesArgs({...request,timeoutMs:config.searchTimeoutMs,instance:probe.instance})),
    },
    pdf:{
      prepare:preparePdfFormIndexForSearch,
      search:(plan,limit)=>searchPdfFormIndex(plan.query,plan.contentSearch,plan.scopePath,limit,plan.sort)
    },
    ordering:{merge:mergeDocumentResults,compare:compareDocumentRows},
    publication:{prune:pruneResults,publish:publicResult},
    audit:{write:appendLog},
  },{bridgeVersion:BRIDGE_VERSION,maxResults:MAX_RESULTS,defaultLimit:DEFAULT_RESULT_LIMIT,recentLimit:RECENT_RESULT_LIMIT});
  async function searchDocuments(query,limit,mode='everything',contentSearch={},scopePath='',offset=0,sort={},fileType='all'){
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
      includePdf:documentFileTypeIncludesPdf(normalizedFileType)
    },limit,offset);
  }
  async function recentDocuments(limit,scopePath='',fileType='all'){
  return documentSearch.recent({scopePath:normalizeSearchScopePath(scopePath),fileType:normalizeDocumentFileType(fileType)},limit);
}
  return {diagnoseIndex,searchDocuments,recentDocuments,runtime:documentSearch};
}
