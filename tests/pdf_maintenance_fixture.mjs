import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {tokens} from './bank_policy_ast_fixture.mjs';
import {createPdfMaintenanceOperation} from '../netunim-orders/document-bridge/pdf-maintenance-operation.mjs';
import {pdfMaintenanceInventoryPlan} from '../netunim-orders/document-bridge/pdf-index-policy.mjs';
export const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/pdf-maintenance-policy.json',import.meta.url),'utf8'));
for(const entry of Object.values(baseline.functions))if(createHash('sha256').update(tokens(entry.source)).digest('hex')!==entry.digest)throw new Error('modified_pdf_maintenance_baseline');
const script=new vm.Script(baseline.functions.isAbortError.source+'\n'+baseline.functions.refreshPdfFormIndex.source+'\nrefreshPdfFormIndex');
export const plain=value=>JSON.parse(JSON.stringify(value));
export const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
export const workRow=index=>({fullPath:`C:\\synthetic\\${index}.pdf`,name:`${index}.pdf`,relativePath:'C:\\synthetic',modified:'2026-10-15T00:00:00Z',size:11,extension:'pdf',fingerprint:'11:synthetic'});
export const limits={PDF_FORM_MAINTENANCE_MAX_FILES:300,PDF_FORM_MAINTENANCE_MAX_MS:0,PDF_FORM_MAINTENANCE_INTERVAL_MS:72000000,PDF_FORM_RECONCILE_INTERVAL_MS:72000000,PDF_FORM_RETRY_MS:86400000,PDF_FORM_MAX_BYTES:99999,PDF_FORM_DETECTION_REVISION:2,PDF_FORM_SEARCH_TEXT_REVISION:2,PDF_FORM_GEOMETRY_REVISION:1};
export function maintenanceFixture(version='current',options={}){
 let time=Date.parse('2026-10-15T12:00:00Z'),metadata=options.metadata??{},extractions=0;
 const entries=new Map(options.entries||[]),events=[],logs=[],timers=new Map(),rows=options.rows||[workRow(1),workRow(2)];
 const context={...limits,AbortController,Date:class extends Date{constructor(value=time){super(value)}static now(){return time}},process:{cpuUsage:()=>({user:0,system:0})},
  shuttingDown:!!options.stopping,pdfMaintenanceStopRequested:false,pdfFormIndexRefreshPromise:null,pdfFormIndexRefreshAbortController:null,pdfFormIndexPending:rows.length,pdfFormIndexInventoryCount:rows.length,pdfFormIndexBacklog:[],pdfFormIndex:entries,PDF_FORM_MAINTENANCE_PATH:'synthetic',
  setTimeout:(callback,ms)=>{const handle={unref:()=>{}};timers.set(handle,{callback,ms});return handle},clearTimeout:handle=>timers.delete(handle),
  loadPdfFormIndex:async()=>{events.push(['load']);if(options.load)await options.load()},
  readJsonFile:async()=>{events.push(['metadata-read']);return options.metadataRead?options.metadataRead():plain(metadata)},
  writeJsonFile:async(_file,value)=>{events.push(['metadata-write',plain(value)]);if(options.metadataWrite)await options.metadataWrite(value);metadata=plain(value)},
  appendLog:async text=>{logs.push(text);if(options.audit)await options.audit(text)},
  pdfMaintenanceInventoryPlan,
  rebuildPdfFormIndexBacklog:async input=>{events.push(['inventory',{full:input.full,modifiedSince:input.modifiedSince}]);if(options.rebuild)await options.rebuild(input);context.pdfFormIndexBacklog=[...rows];context.pdfFormIndexPending=rows.length;context.pdfFormIndexInventoryCount=rows.length;return{pdfCount:rows.length,changed:rows.length,removed:0,rows:[...rows]}},
  pdfIndexKey:fullPath=>String(fullPath||'').toLocaleLowerCase('en-US'),normalizePdfFormFields:value=>Array.isArray(value)?value:[],serializePdfIndexEntry:entry=>plain(entry),
  appendPdfIndexJournal:async records=>{events.push(['append',plain(records)]);if(options.append)await options.append(records);for(const record of records)entries.set(record.entry.fullPath.toLowerCase(),record.entry)},
  compactPdfFormIndex:async counts=>{events.push(['compact',plain(counts)]);if(options.compact)await options.compact(counts);context.pdfFormIndexPending=counts.pending},
  fs:{stat:async()=>({mtimeMs:50})},extractInteractivePdfText:async(file,input)=>{
   extractions++;events.push(['extract',file]);input.onBytesRead(10);if(options.extract)await options.extract(file,input);time+=options.extractMs||0;
   if(['error','password','abort'].includes(options.outcome)){const error=Object.assign(new Error(options.outcome==='password'?'No password given':'synthetic extraction error'),options.outcome==='abort'?{name:'AbortError',code:'ABORT_ERR'}:{});throw error}
   return {hasForm:options.outcome!=='noform',text:'synthetic searchable content',formFields:[],formFieldCount:0};
  }};
 const ports={index:{load:context.loadPdfFormIndex,entries,view:()=>({pending:context.pdfFormIndexPending,pdfCount:context.pdfFormIndexInventoryCount}),publishPending:pending=>{context.pdfFormIndexPending=pending},append:context.appendPdfIndexJournal,serialize:context.serializePdfIndexEntry,compact:context.compactPdfFormIndex},
  inventory:{rebuild:context.rebuildPdfFormIndexBacklog},extraction:{read:context.extractInteractivePdfText,stat:context.fs.stat,fields:context.normalizePdfFormFields},
  metadata:{read:context.readJsonFile,write:value=>context.writeJsonFile('synthetic',value)},policy:{limits,plan:pdfMaintenanceInventoryPlan},
  runtime:{now:context.Date.now,cpuUsage:context.process.cpuUsage,isStopping:()=>context.shuttingDown||context.pdfMaintenanceStopRequested,setTimeout:context.setTimeout,clearTimeout:context.clearTimeout},audit:{write:context.appendLog}};
 const refresh=version==='baseline'?script.runInNewContext(context):null;
 const owner=refresh?{refresh,stop:()=>context.pdfFormIndexRefreshAbortController?.abort()}:createPdfMaintenanceOperation(ports);
 return {owner,ports,context,events,logs,timers,extractions:()=>extractions,metadata:()=>plain(metadata),observation:()=>plain({events,logs,metadata,pending:context.pdfFormIndexPending,entries:[...entries]})};
}
