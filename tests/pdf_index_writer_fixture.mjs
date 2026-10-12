import {createPdfIndexReader} from '../netunim-orders/document-bridge/pdf-index-reader.mjs';
import {createPdfIndexWriter} from '../netunim-orders/document-bridge/pdf-index-writer.mjs';
export const row=(fullPath,text='retained')=>({fullPath,text});
export function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
export function writerFixture(){
  const disk={snapshot:JSON.stringify({schema:3,entries:[row('C:\\base.pdf')],pending:2,pdfCount:3}),journal:'',revision:0},calls=[],published=[];let reads=0,queue=Promise.resolve();
  const reader=createPdfIndexReader({files:{readSnapshot:async()=>{reads++;return disk.snapshot},readJournal:async()=>disk.journal,signature:async()=>String(disk.revision)},normalizeEntry:value=>value});
  const files={signature:async()=>String(disk.revision),appendJournal:async text=>{calls.push('append');disk.journal+=text;disk.revision++},
    replaceSnapshot:async text=>{calls.push('snapshot');disk.snapshot=text;disk.revision++},clearJournal:async()=>{calls.push('clear');disk.journal='';disk.revision++}};
  const ports={reader,files,lock:{run:work=>{const task=queue.then(work);queue=task.catch(()=>{});return task}},serializeEntry:value=>value,publish:(candidate,phase)=>{published.push({candidate,phase})},now:()=>123456};
  return {disk,calls,published,ports,writer:createPdfIndexWriter(ports),reads:()=>reads,recover:()=>reader.read()};
}
