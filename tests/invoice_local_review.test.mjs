import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseLocalReview} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-local.js';

const proposal={profile:'roya',fields:{supplier:{value:'123456789'},invoiceNumber:{value:'0123456789'}}};
function fixture() {
  let source={type:'application/pdf',file:new Blob(['%PDF-1.4 local invoice'])}, version=0, scoped=true, draft=null, conflict=false, rows=[], hold=null, uploads=0;
  const calls=[],caps={environment:'sandbox',ocrFileGuard:true};
  const local=createExpenseLocalReview({files:{extract:async()=>{if(hold)await hold;return {text:'private invoice text'};},recognize:async()=>proposal,upload:()=>uploads++},
    selected:()=>source,capabilities:()=>caps,editVersion:()=>version,capture:()=>()=>{if(!scoped)throw Error('stale account');},
    apply:async(value,check)=>{check();draft=value;},render:()=>{},run:work=>work(),canStart:()=>true,ocrActive:()=>false,confirmDialog:async()=>true,
    request:async(action,body,check)=>{check();calls.push({action,body});if(action==='ocr_lookup')return {hasOcrOperation:conflict};
      assert.equal(action,'expenses');const items=rows.filter(row=>row.number===body.number);return {version:1,environment:'sandbox',page:0,pageSize:50,pages:items.length?1:0,total:items.length,items};}});
  const snapshot={number:'0123456789',documentType:305,date:'2026-08-12'},supplier={id:'canonical',taxId:'123456789'};
  return {local,calls,caps,snapshot,supplier,getDraft:()=>draft,getUploads:()=>uploads,edit:()=>{version++;local.edited();},
    switchSource:()=>{source={type:'application/pdf',file:new Blob(['%PDF other file'])};local.reset();},switchAccount:()=>{scoped=false;local.reset();},
    conflict:()=>conflict=true,setRows:value=>rows=value,hold:promise=>hold=promise};
}
test('local selection only reads metadata; approval is recorded only at final confirmation',async()=>{
  const f=fixture();await f.local.start();assert.equal(f.getDraft(),proposal);assert.equal(f.getUploads(),0);
  assert.deepEqual(f.calls.map(row=>row.action),['ocr_lookup']);assert.equal(f.local.blocked(),false);
  f.local.approve('0123456789');assert.equal(proposal.fields.invoiceNumber.effectiveNumber,'0123456789');
  f.edit();assert.equal(f.local.blocked(),false);assert.equal(proposal.fields.invoiceNumber.effectiveNumber,null);
  assert.ok(!f.local.markup().includes('private invoice text'));f.switchSource();assert.equal(f.local.blocked(),true);
});
test('late extraction cannot overwrite edits, a different file or a different account',async()=>{
  for(const mode of ['edit','switchSource','switchAccount']){
    const f=fixture();let release;f.hold(new Promise(resolve=>release=resolve));const work=f.local.start();
    await new Promise(resolve=>setTimeout(resolve,5));f[mode]();release();await work;assert.equal(f.getDraft(),null,mode);
    if(mode==='edit'){await f.local.fill();assert.equal(f.getDraft(),proposal);}
  }
});
test('unknown OCR state and deferred OCR both prevent ordinary creation',async()=>{
  for(const mode of ['oldBackend','ocrConflict']){
    const f=fixture();if(mode==='oldBackend')f.caps.ocrFileGuard=false;else f.conflict();
    await f.local.start();assert.equal(f.local.blocked(),true);
    await assert.rejects(()=>f.local.preflight(f.snapshot,f.supplier,()=>{}));
    assert.ok(f.calls.every(row=>row.action==='ocr_lookup'));
  }
});
test('legacy zero-less number is compared for duplicates without changing the proposed number',async()=>{
  const f=fixture();await f.local.start();
  f.setRows([{id:'reported',kind:'expense',status:10,number:'123456789',type:305,sourceDocumentDate:'2026-07-02',supplierId:'canonical'}]);
  await assert.rejects(()=>f.local.preflight(f.snapshot,f.supplier,()=>{}),/הוצאה קיימת/);
  assert.deepEqual(f.calls.filter(row=>row.action==='expenses').map(row=>row.body.number),['0123456789','123456789']);
  assert.equal(f.snapshot.number,'0123456789');assert.equal(proposal.fields.invoiceNumber.value,'0123456789');
});
test('same number on another verified supplier/year/type does not falsely match',async()=>{
  const f=fixture();await f.local.start();
  f.setRows([{id:'other',kind:'expense',status:10,number:f.snapshot.number,type:305,sourceDocumentDate:'2026-08-12',supplierId:'other',supplierTaxId:'987654321'},
    {id:'year',kind:'expense',status:10,number:f.snapshot.number,type:305,sourceDocumentDate:'2025-08-12',supplierId:f.supplier.id},
    {id:'credit',kind:'expense',status:10,number:f.snapshot.number,type:330,sourceDocumentDate:'2026-08-12',supplierId:f.supplier.id}]);
  await f.local.preflight(f.snapshot,f.supplier,()=>{});f.conflict();await assert.rejects(()=>f.local.verifySource(()=>{}),/פעולת OCR/);
});
