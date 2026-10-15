import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfInventoryReconciliation} from '../netunim-orders/document-bridge/pdf-inventory-reconciliation.mjs';
const row=i=>({fullPath:'C:\\synthetic\\'+i+'.pdf',modified:'2026-10-01',size:1,fingerprint:'1:2026-10-01',detectionRevision:2,searchTextRevision:2});
function fixture(size,rows,factory=createPdfInventoryReconciliation){
 const entries=new Map(Array.from({length:size},(_,i)=>[row(i).fullPath.toLowerCase(),row(i)])),writes=[],published=[];
 const owner=factory({inventory:{read:async()=>rows,assertActive:signal=>{if(signal?.aborted)throw Object.assign(Error('stopped'),{code:'ABORT_ERR'})}},index:{entries,key:value=>value.toLowerCase(),fingerprint:value=>`${value.size}:${value.modified}`,append:async records=>writes.push(records),view:()=>({pdfCount:size}),publish:value=>published.push(value)},policy:{PDF_FORM_DETECTION_REVISION:2,PDF_FORM_SEARCH_TEXT_REVISION:2},clock:{now:()=>100000}});
 return {owner,entries,writes,published};
}
test('full inventory shrink protection refuses removal before any journal mutation',async()=>{
 const f=fixture(101,[row(1)]);await assert.rejects(f.owner.rebuild({full:true}),/unexpectedly shrank/);assert.equal(f.entries.size,101);assert.deepEqual(f.writes,[]);assert.deepEqual(f.published,[]);
});
test('incremental reconciliation cannot delete entries absent from its modified-since window',async()=>{
 const f=fixture(3,[row(1)]);const result=await f.owner.rebuild({modifiedSince:'2026-10-01'});assert.equal(result.removed,0);assert.deepEqual(f.writes,[]);assert.deepEqual(f.published,[{pending:0,pdfCount:3}]);
});
test('failed entries remain retryable even when absent from an incremental window',async()=>{
 const f=fixture(2,[]);f.entries.get(row(0).fullPath.toLowerCase()).failed=true;const result=await f.owner.rebuild();assert.equal(result.changed,1);assert.equal(result.rows[0].fullPath,row(0).fullPath);assert.equal(result.removed,0);
});


test('negative implementation: removing the full shrink guard permits forbidden cache removals',async()=>{
 const {readFileSync}=await import('node:fs'),url=new URL('../netunim-orders/document-bridge/pdf-inventory-reconciliation.mjs',import.meta.url);
 const original=readFileSync(url,'utf8'),mutated=original.replace('pdfFormIndex.size>100&&rows.length<pdfFormIndex.size/2','false').replace("from './pdf-index-policy.mjs'",'from '+JSON.stringify(new URL('./pdf-index-policy.mjs',url).href));assert.notEqual(mutated,original);
 const {createPdfInventoryReconciliation:factory}=await import('data:text/javascript;base64,'+Buffer.from(mutated).toString('base64'));
 const f=fixture(101,[row(1)],factory);await f.owner.rebuild({full:true});assert.equal(f.writes[0].length,100,'the retained-cache scenario must detect this implementation mutation');
});
