import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitInvoicePdf} from '../netunim-orders/site/assets/js/domains/finance/invoice-pdf-split.js';
const source=()=>new File(['%PDF-1.4 original'],'source.pdf',{type:'application/pdf'});
function fixture({count=2,invalid=false,hold=false}={}){
 let destroyed=0;const calls=[];
 return {calls,destroyed:()=>destroyed,load:async()=>({getDocument:()=>({promise:Promise.resolve({numPages:count,extractPages:async infos=>{
  calls.push(infos);return hold?new Promise(()=>{}):new TextEncoder().encode(invalid?'invalid':'%PDF-1.4 split '+calls.length);
 }}),destroy:async()=>{destroyed++;}})})};
}
test('split preserves each page through the native PDF API, names files and destroys its worker',async()=>{
 const f=fixture(),files=await splitInvoicePdf(source(),[1,2],{load:f.load});
 assert.deepEqual(f.calls,[[{document:null,includePages:[0]}],[{document:null,includePages:[1]}]]);
 assert.deepEqual(files.map(file=>[file.name,file.type]),[['source - 1.pdf','application/pdf'],['source - 2.pdf','application/pdf']]);
 assert.notEqual(await files[0].text(),await files[1].text());assert.equal(f.destroyed(),1);
});
test('missing pages, oversized plans and invalid outputs fail atomically',async()=>{
 for(const pages of [[1],[2,1],[1,3],Array.from({length:21},(_,n)=>n+1)])await assert.rejects(splitInvoicePdf(source(),pages),/plan_invalid/);
 const wrong=fixture({count:3});await assert.rejects(splitInvoicePdf(source(),[1,2],{load:wrong.load}),/plan_invalid/);assert.equal(wrong.destroyed(),1);
 const invalid=fixture({invalid:true});await assert.rejects(splitInvoicePdf(source(),[1,2],{load:invalid.load}),/output_invalid/);assert.equal(invalid.destroyed(),1);
});
test('cancellation, timeouts and ownership changes release the worker without returning partial outputs',async()=>{
 const f=fixture({hold:true}),controller=new AbortController();
 const pending=splitInvoicePdf(source(),[1,2],{load:f.load,signal:controller.signal});
 await new Promise(resolve=>setTimeout(resolve,0));controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(f.destroyed(),1);
 const timed=fixture({hold:true});await assert.rejects(splitInvoicePdf(source(),[1,2],{load:timed.load,timeoutMs:5}),{name:'TimeoutError'});assert.equal(timed.destroyed(),1);
 await assert.rejects(splitInvoicePdf(source(),[1,2],{check:()=>{throw Error('stale account');}}),/stale account/);
});
