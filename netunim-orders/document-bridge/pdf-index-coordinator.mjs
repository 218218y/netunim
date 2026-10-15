import path from 'node:path';
import {DEFAULT_RESULT_LIMIT,contentSearchMatches,compareDocumentRows} from './lib.mjs';
import {createPdfIndexReader} from './pdf-index-reader.mjs';
import {createPdfIndexFilePlatform} from './pdf-index-file-platform.mjs';
import {createPdfIndexWriter} from './pdf-index-writer.mjs';
import {createPdfIndexWritePlatform} from './pdf-index-write-platform.mjs';
import {createPdfInventory} from './pdf-inventory.mjs';
import {createEverythingInventorySource} from './everything-inventory-source.mjs';
import {createPdfInventoryReconciliation} from './pdf-inventory-reconciliation.mjs';

// Owns derived index publication, reload signatures, backlog and search projection.
// Lower reader/writer/inventory owners retain validation, locking and wire policy.
export function createPdfIndexCoordinator({files,locking,everything,cache,runtime,policy}) {
  const {PDF_FORM_INDEX_PATH,PDF_FORM_INDEX_JOURNAL_PATH,PDF_FORM_INDEX_LOCK_PATH}=files;
  const {PDF_FORM_INDEX_PAGE_SIZE,PDF_FORM_DETECTION_REVISION,PDF_FORM_SEARCH_TEXT_REVISION}=policy;
  const {loadConfig,probeEverything,runEs}=everything;
  const {withFileLock}=locking;
  const previewTextCache=cache;
  const appendLog=runtime.log;
  let pdfFormIndexLoaded=false,pdfFormIndexLastRefresh=0,pdfFormIndexPending=0,pdfFormIndexInventoryCount=0,pdfFormIndexSignature='';
  const pdfFormIndex=new Map();
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
    const fullPath=String(entry?.fullPath||'');
    if(!fullPath)return null;
    const hasForm=typeof entry.hasForm==='boolean'?entry.hasForm:(Math.max(0,Number(entry.formFieldCount)||0)>0||!!String(entry.text||'')),formFields=normalizePdfFormFields(entry.formFields);
    const legacyRevision=Math.max(0,Number(entry.extractorRevision)||0);
    return {
      fullPath,
      name:String(entry.name||path.win32.basename(fullPath)),
      relativePath:String(entry.relativePath||path.win32.dirname(fullPath)),
      modified:String(entry.modified||''),
      size:Number.isFinite(Number(entry.size))?Number(entry.size):null,
      fileMtimeMs:Number(entry.fileMtimeMs)||0,
      extension:'pdf',
      attributes:String(entry.attributes||''),
      isDirectory:false,
      rootId:'everything',
      rootLabel:'Everything',
      fingerprint:String(entry.fingerprint||''),
      detectionRevision:Math.max(0,Number(entry.detectionRevision)||legacyRevision),
      searchTextRevision:Math.max(0,Number(entry.searchTextRevision)||legacyRevision),
      geometryRevision:Math.max(0,Number(entry.geometryRevision)||((hasForm&&formFields.length)?legacyRevision:0)),
      hasForm,
      text:String(entry.text||''),
      formFields,
      formFieldCount:Math.max(formFields.length,Math.max(0,Number(entry.formFieldCount)||0)),
      failed:!!entry.failed,
      error:String(entry.error||''),
      retryAfter:String(entry.retryAfter||''),
      retryCount:Math.max(0,Number(entry.retryCount)||0)
    };
  }
  function serializePdfIndexEntry(entry){return {
      fullPath:entry.fullPath,
      name:entry.name,
      relativePath:entry.relativePath,
      modified:entry.modified,
      size:entry.size,
      fileMtimeMs:entry.fileMtimeMs||0,
      attributes:entry.attributes||'',
      fingerprint:entry.fingerprint,
      detectionRevision:Math.max(0,Number(entry.detectionRevision)||0),
      searchTextRevision:Math.max(0,Number(entry.searchTextRevision)||0),
      geometryRevision:Math.max(0,Number(entry.geometryRevision)||0),
      hasForm:!!entry.hasForm,
      text:entry.text||'',
      formFields:normalizePdfFormFields(entry.formFields),
      formFieldCount:entry.formFieldCount||0,
      failed:!!entry.failed,
      error:entry.error||'',
      retryAfter:entry.retryAfter||'',
      retryCount:entry.retryCount||0
    }}
  const pdfIndexFiles=createPdfIndexFilePlatform({snapshotPath:PDF_FORM_INDEX_PATH,journalPath:PDF_FORM_INDEX_JOURNAL_PATH});
  const pdfIndexReader=createPdfIndexReader({files:pdfIndexFiles,normalizeEntry:normalizePdfIndexEntry});
  const pdfIndexSignature=()=>pdfIndexFiles.signature();
  const pdfIndexWriter=createPdfIndexWriter({
    reader:pdfIndexReader,
    files:createPdfIndexWritePlatform({snapshotPath:PDF_FORM_INDEX_PATH,journalPath:PDF_FORM_INDEX_JOURNAL_PATH}),
    lock:{run:work=>withFileLock(PDF_FORM_INDEX_LOCK_PATH,work)},
    serializeEntry:serializePdfIndexEntry,
    publish:(candidate,phase)=>publishPdfIndexCandidate(candidate,{metadata:phase==='compact'}),
    now:Date.now,
  });
  function publishPdfIndexCandidate(candidate,{metadata=true}={}){
  // Publication is synchronous and follows complete, stable candidate decoding.
  // Retire match text for both removed and retained PDF entries on disk reload.
    for(const key of pdfFormIndex.keys())previewTextCache.invalidate(key);
    pdfFormIndex.clear();
    for(const [key,entry] of candidate.entries){pdfFormIndex.set(key,entry);previewTextCache.invalidate(key)}
    if(metadata){pdfFormIndexPending=candidate.pending;pdfFormIndexInventoryCount=candidate.pdfCount;pdfFormIndexLastRefresh=candidate.updatedAt}
    pdfFormIndexLoaded=true;
    pdfFormIndexSignature=candidate.signature;
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
  isStopping:()=>runtime.isStopping(),
},{pageSize:PDF_FORM_INDEX_PAGE_SIZE});
  const pdfReconciliation=createPdfInventoryReconciliation({
    inventory:pdfInventory,
    index:{
      entries:pdfFormIndex,
      key:pdfIndexKey,
      fingerprint:pdfIndexFingerprint,
      append:appendPdfIndexJournal,
      view:()=>({pdfCount:pdfFormIndexInventoryCount}),
      publish:({pending,pdfCount})=>{pdfFormIndexPending=pending;pdfFormIndexInventoryCount=pdfCount}
    },
    policy:{PDF_FORM_DETECTION_REVISION,PDF_FORM_SEARCH_TEXT_REVISION},
  });
  async function rebuildPdfFormIndexBacklog(options={}){return pdfReconciliation.rebuild(options)}
  async function preparePdfFormIndexForSearch(){
    try{await loadPdfFormIndex()}catch(error){await appendLog(`PDF_FORM_INDEX_LOAD_FAILED ${error?.message||error}`);return {partial:true}}
    return {partial:!pdfFormIndexLastRefresh||pdfFormIndexPending>0};
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
  async function remove(fullPath) {
    await loadPdfFormIndex();
    if(pdfFormIndex.has(pdfIndexKey(fullPath)))await appendPdfIndexJournal([{op:'remove',fullPath}]);
  }
  function view(){return {
      pending:pdfFormIndexPending,
      pdfCount:pdfFormIndexInventoryCount,
      updatedAt:pdfFormIndexLastRefresh,
      inspected:pdfFormIndex.size,
      interactive:[...pdfFormIndex.values()].filter(entry=>entry.hasForm&&!entry.failed).length
    }}
  return {
    index:{
      load:loadPdfFormIndex,
      entries:Object.freeze({
        get size(){return pdfFormIndex.size},
        get:key=>pdfFormIndex.get(key),
        has:key=>pdfFormIndex.has(key),
        keys:()=>pdfFormIndex.keys(),
        values:()=>pdfFormIndex.values(),
        entries:()=>pdfFormIndex.entries(),
        [Symbol.iterator]:()=>pdfFormIndex[Symbol.iterator](),
        forEach:(callback,thisArg)=>pdfFormIndex.forEach((value,key)=>callback.call(thisArg,value,key)),
      }),
      view:()=>({pending:pdfFormIndexPending,pdfCount:pdfFormIndexInventoryCount}),
      publishPending:pending=>{pdfFormIndexPending=pending},
      append:appendPdfIndexJournal,
      serialize:serializePdfIndexEntry,
      compact:compactPdfFormIndex
    },
    inventory:{rebuild:rebuildPdfFormIndexBacklog},
    search:{prepare:preparePdfFormIndexForSearch,search:searchPdfFormIndex},
    forms:{fields:normalizePdfFormFields},
    view,
    remove,
  };
}
