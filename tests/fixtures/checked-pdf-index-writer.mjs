import {createPdfIndexWriter} from '../../netunim-orders/document-bridge/pdf-index-writer.mjs';
/** @type {import('../../netunim-orders/document-bridge/pdf-index-writer.mjs').PdfIndexWriterPorts<{fullPath:string,text:string}>} */
const ports={reader:{read:async()=>({entries:new Map(),pending:0,pdfCount:0,updatedAt:0,signature:''}),stage:candidate=>candidate},
  files:{signature:async()=>'',appendJournal:async()=>{},replaceSnapshot:async()=>{},clearJournal:async()=>{}},lock:{run:work=>work()},serializeEntry:entry=>entry,publish:()=>{},now:Date.now};
const writer=createPdfIndexWriter(ports);writer.append([{op:'remove',fullPath:'C:\\synthetic.pdf'}]);writer.compact({pending:1,pdfCount:2});
// @ts-expect-error publication must be synchronous after commit
createPdfIndexWriter({...ports,publish:async()=>{}});
// @ts-expect-error a write must settle asynchronously before publication
createPdfIndexWriter({...ports,files:{...ports.files,appendJournal:()=>true}});
// @ts-expect-error publication metadata is numeric
writer.compact({pending:'1'});
/** @param {string} entry */
const wrongSerializer=entry=>entry;
// @ts-expect-error paths do not substitute for the captured generic entry
createPdfIndexWriter({...ports,serializeEntry:wrongSerializer});
// @ts-expect-error signature is a scoped file revision, not a boolean readiness flag
createPdfIndexWriter({...ports,files:{...ports.files,signature:async()=>true}});
