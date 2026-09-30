import {createSearchScheduler} from '../shared/search-scheduler.js';

export const DOCUMENT_FILE_SEARCH_DELAY_MS=45;
export const DOCUMENT_CONTENT_SEARCH_DELAY_MS=220;

export function createDocumentSearchLanes(run){
  if(typeof run!=='function')throw new TypeError('Document search lanes require a runner');
  const aborts={everything:null,content:null};
  const file=createSearchScheduler(value=>run(value,'everything'),{delay:DOCUMENT_FILE_SEARCH_DELAY_MS});
  const content=createSearchScheduler(value=>run(value,'content'),{delay:DOCUMENT_CONTENT_SEARCH_DELAY_MS});
  const scheduler=mode=>mode==='content'?content:file;
  return {
    schedule(mode,value){scheduler(mode)(value)},
    cancel(){file.cancel();content.cancel()},
    flush(){const pending=[file.flush(),content.flush()].filter(Boolean);return pending.length?Promise.all(pending):undefined},
    begin(mode){const key=mode==='content'?'content':'everything';aborts[key]?.abort();const controller=new AbortController();aborts[key]=controller;return controller},
    clear(mode,controller){const key=mode==='content'?'content':'everything';if(aborts[key]===controller)aborts[key]=null},
    abortAll(){for(const key of ['everything','content']){aborts[key]?.abort();aborts[key]=null}},
  };
}

export function appendUniqueDocumentRows(existing,incoming){
  const rows=[...(Array.isArray(existing)?existing:[])],key=row=>`${String(row?.sourceProvider||row?.rootId||'')}|${String(row?.relativePath||'')}|${String(row?.name||'')}`.toLocaleLowerCase('en-US'),seen=new Set(rows.map(key));
  for(const row of Array.isArray(incoming)?incoming:[]){const value=key(row);if(!value||seen.has(value))continue;seen.add(value);rows.push(row)}
  return rows;
}
