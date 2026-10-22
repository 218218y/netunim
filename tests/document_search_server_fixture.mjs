import {joinDocumentReads} from '../netunim-orders/document-bridge/document-command-owner.mjs';
import {documentBridgeSource} from './document_bridge_source.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {tokens} from './bank_policy_ast_fixture.mjs';
import * as lib from '../netunim-orders/document-bridge/lib.mjs';
import {createDocumentSearch} from '../netunim-orders/document-bridge/search-owner.mjs';
import {createDocumentResultRegistry} from '../netunim-orders/document-bridge/result-registry.mjs';

export const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/document-search-policy.json',import.meta.url),'utf8'));
for(const entry of Object.values(baseline.functions)) {
 if(createHash('sha256').update(tokens(entry.source)).digest('hex')!==entry.digest) throw new Error('modified_document_search_baseline');
}
const {source,ast:ast}=documentBridgeSource();
const pdfPreparation=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='preparePdfFormIndexForSearch');
const prepareScript=new vm.Script(source.slice(pdfPreparation.start,pdfPreparation.end)+'\npreparePdfFormIndexForSearch');
const names=['searchDocuments','recentDocuments','searchEverything','pruneResults','publicResult','resolveResult','invalidateResultPath','prepareShutdown'];
const compositions=ast.body.filter(node=>node.type==='VariableDeclaration'&&node.declarations.some(item=>['documentSearch','documentResults'].includes(item.id.name)));
const declarations=ast.body.filter(node=>node.type==='FunctionDeclaration'&&names.includes(node.id.name));
const expose='\n({search:searchDocuments,recent:recentDocuments,resolve:resolveResult,invalidate:invalidateResultPath,shutdown:typeof prepareShutdown===\'function\'?prepareShutdown:null})';
const scripts={baseline:new vm.Script(Object.entries(baseline.functions).filter(([name])=>names.includes(name)).map(([,entry])=>entry.source).join('\n')+expose),
 current:new vm.Script([...compositions,...declarations].map(node=>source.slice(node.start,node.end)).join('\n')+expose)};

export function row(index,{fullPath=`C:\\synthetic\\document-${index}.pdf`,...patch}={}) {
 return {fullPath,name:`document-${index}.pdf`,relativePath:'C:\\synthetic',modified:`2026-10-${String(15-index%14).padStart(2,'0')}T12:00:00Z`,size:index*11,
  extension:'pdf',attributes:'A',isDirectory:false,...patch};
}
export const plain=value=>JSON.parse(JSON.stringify(value));
export const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
export function serverFixture(version='current',options={}) {
 let time=10_000,id=0;const calls=[],logs=[],stats=[],invalidations=[];
 const stat={size:20,mtimeMs:50,mtime:new Date(50),isDirectory:()=>false};
 const context={...lib,createDocumentSearch,createDocumentResultRegistry,performance,
  Date:{now:()=>time},everythingSession:{dispose:async()=>{}},everythingDiscovery:{dispose:async()=>{}},everythingProcesses:{dispose:async()=>{}},crypto:{randomUUID:()=>`opaque-${++id}`},fs:{stat:async fullPath=>{stats.push(fullPath);return options.stat?options.stat(fullPath):stat}},
  requestResults:new Map(),pdfFormIndex:new Map(),previewTextCache:{invalidate:key=>invalidations.push(key),dispose:()=>{}},
  loadPdfFormIndex:async()=>{if(options.pdfLoad){calls.push(['pdf-prepare']);await options.pdfLoad()}},appendPdfIndexJournal:async()=>{},
  pdfFormIndexLastRefresh:1,pdfFormIndexPending:0,
  loadConfig:async()=>({searchTimeoutMs:123}),probeEverything:async()=>({instance:'synthetic',esPath:'never-launched'}),
  runEverythingJson:async build=>{
   const args=build({searchTimeoutMs:123},{instance:'synthetic'});calls.push(['everything',args]);
   if(options.everything)return options.everything(args);
   const offset=Number(args[args.indexOf('-offset')+1])||0,limit=Number(args[args.indexOf('-max-results')+1]);
   return {rows:(options.rows||[row(1),row(2),row(3)]).slice(offset,offset+limit),elapsedMs:17};
  },
  preparePdfFormIndexForSearch:async()=>{calls.push(['pdf-prepare']);return options.prepare?options.prepare():{partial:!!options.partial}},
  searchPdfFormIndex:(query,contentSearch,scopePath,limit,sort)=>{calls.push(['pdf-search',query,contentSearch,scopePath,limit,sort]);return (options.pdfRows||[row(2),row(4),row(5)]).slice(0,limit)},
  appendLog:async text=>{logs.push(text);if(options.audit)await options.audit(text)},
  manualMaintenance:{dispose:async()=>{}},pdfPreviewOperation:{dispose:async()=>{},invalidate:async()=>{}},pdfExtractionProcesses:{dispose:async()=>{}},nativePreviewSession:{dispose:async()=>{}},pdfMaintenanceOperation:{dispose:async()=>{}},process:{pid:101},documentCommands:{dispose:async()=>{}},joinDocumentReads,shuttingDown:false,
 };
 context.pdfIndexRuntime={remove:async()=>{}};
 if(options.pdfLoad)context.preparePdfFormIndexForSearch=prepareScript.runInNewContext(context);
 const api=scripts[version].runInNewContext(context);
 return {...api,context,calls,logs,stats,invalidations,ids:()=>id,setTime:value=>{time=value},stat,
  observation:()=>plain({calls,logs,stats,invalidations,ids:id})};
}
