import fs from 'node:fs/promises';
import path from 'node:path';
import {createFileLockOwner} from './file-lock-owner.mjs';
import {createFileLockPlatform} from './file-lock-platform.mjs';

const events=new Set(('SEARCH RECENT NATIVE_PREVIEW_OPEN SEARCH_SCOPE_PICK PREVIEW_CONTENT_FAILED PREVIEW_MATCHES OPEN REVEAL DELETE HTTP_ERROR UNHANDLED SERVER START STOP FATAL EVERYTHING_READY EVERYTHING_START EVERYTHING_BACKGROUND_START_FAILED PDF_FORM_INDEX_LOAD_FAILED PDF_FORM_PREVIEW_FAILED PDF_FORM_INDEX_FILE_FAILED PDF_FORM_INDEX_MAINTENANCE PDF_FORM_INDEX_MAINTENANCE_STOPPED PDF_FORM_INDEX_MAINTENANCE_FAILED NATIVE_PREVIEW_FORCE_STOP INSTALL_STOP_FORCE MAINTENANCE_FORCE_STOP NATIVE_PREVIEW_EXIT MAINTENANCE_EXIT').split(' '));
const numeric=new Set(('offset limit results everythingResults pdfSupplemental elapsedMs count snippets formAnchors invalidated pid pdfs changed processed pending inspected interactive indexed failed removed bytesRead cpuMs everythingMs candidateAdmissionMs rootValidationMs pathValidationMs hiddenValidationMs pdfPrepareMs pdfSearchMs publicationMs').split(' '));
const booleans=new Set(['hasMore','partial','authoritative','aborted']);
const enums={mode:new Set(['everything','content','recent','reconcile','incremental']),type:new Set(['file','folder']),kind:new Set(['word','excel','powerpoint']),fileType:new Set(['all','audio','documents','folders','images','video','pdf','word','excel','powerpoint','text']),source:new Set(['file','everything-content','pdfjs-acroform','unavailable']),code:new Set(('ERROR PDF_EXTRACTION_RESULT_INVALID ENOENT EACCES EPERM ENOTDIR EIO ETIMEDOUT EADDRINUSE QUERY_TOO_SHORT RESULT_EXPIRED DOCUMENT_PATH_FORBIDDEN DOCUMENT_ROOTS_NOT_CONFIGURED ES_TIMEOUT ES_EXIT_ERROR ES_OUTPUT_LIMIT ES_CONTENT_TOO_LARGE INVALID_JSON REQUEST_TOO_LARGE OPEN_TARGET_MISSING WINDOWS_REQUIRED DOCUMENT_SEARCH_DISPOSED').split(' '))};

// A closed field/value vocabulary is a second barrier if a future caller passes
// a native error, query, token, path or document body to the diagnostic sink.
export function privateAuditLine(message){
  const [event,...parts]=String(message).split(/\s+/);
  if(!events.has(event))return 'EVENT';
  const fields=[];
  for(const part of parts){
    const match=/^([a-zA-Z]+)=([^=]+)$/.exec(part);
    if(!match)continue;
    const [,key,value]=match;
    if(numeric.has(key)&&/^\d{1,12}(?:\.\d{1,6})?$/.test(value)
      ||booleans.has(key)&&['true','false'].includes(value)
      ||enums[key]?.has(value))fields.push(`${key}=${value}`);
  }
  return [event,...fields].join(' ');
}

// Runtime and PDF-maintenance processes share the established PID/token lock.
// Contention drops a diagnostic event immediately, never delays a search behind
// another process. A per-process queue bounds concurrent callers to one writer.
export function createPrivateAuditLog({root,files=fs,now=Date.now,maxBytes=1024*1024,backups=3,maxAgeMs=7*86400000,lock}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<256||!Number.isSafeInteger(backups)||backups<1||backups>10||!Number.isFinite(maxAgeMs)||maxAgeMs<=0)throw Error('audit_log_limits_invalid');
  const logPath=path.join(root,'bridge.log'),policyPath=path.join(root,'bridge-log-policy.json');
  const locking=lock||createFileLockOwner({...createFileLockPlatform({root}),clock:()=>performance.now(),wait:async()=>{}});
  const lockPath=path.join(root,'bridge-log.lock');
  let tail=Promise.resolve();
  async function stat(file){try{return await files.stat(file)}catch(error){if(error.code==='ENOENT')return null;throw error}}
  async function remove(file){try{await files.unlink(file)}catch(error){if(error.code!=='ENOENT')throw error}}
  async function maintain(){
    await files.mkdir(root,{recursive:true});
    let policy;
    try{policy=JSON.parse(await files.readFile(policyPath,'utf8'))}catch{}
    // Old unstructured logs cannot be retained as rotated privacy-safe logs.
    if(policy?.schema!==1){
      for(let index=0;index<=backups;index++)await remove(index?`${logPath}.${index}`:logPath);
      await files.writeFile(policyPath,JSON.stringify({schema:1})+'\n',{encoding:'utf8',mode:0o600});
    }
    for(let index=0;index<=backups;index++){
      const file=index?`${logPath}.${index}`:logPath,info=await stat(file);
      if(info&&now()-Math.min(info.birthtimeMs,info.mtimeMs)>=maxAgeMs)await remove(file);
    }
  }
  async function write(message){
    await maintain();
    const line=`${new Date(now()).toISOString()} ${privateAuditLine(message)}\n`;
    const info=await stat(logPath);
    if(info&&info.size+Buffer.byteLength(line)>maxBytes){
      await remove(`${logPath}.${backups}`);
      for(let index=backups-1;index>=0;index--){
        const from=index?`${logPath}.${index}`:logPath;
        try{await files.rename(from,`${logPath}.${index+1}`)}catch(error){if(error.code!=='ENOENT')throw error}
      }
    }
    // Closed vocabulary already bounds lines; enforce the byte budget as well.
    if(Buffer.byteLength(line)<=maxBytes)await files.appendFile(logPath,line,{encoding:'utf8',mode:0o600});
  }
  function enqueue(task){
    tail=tail.then(()=>locking.run(lockPath,task,{waitMs:0})).catch(()=>{});
    return tail;
  }
  return {append:message=>enqueue(()=>write(message)),prune:()=>enqueue(maintain),drain:()=>tail};
}
