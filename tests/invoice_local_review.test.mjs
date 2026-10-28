import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseLocalReview} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-local.js';

const proposal={profile:'roya',fields:{supplier:{value:'123456789'},invoiceNumber:{value:'0123456789'}}};
function fixture({recognized=proposal,extractionError=null}={}) {
  let source={type:'application/pdf',file:new Blob(['%PDF-1.4 local invoice'])}, version=0, scoped=true, draft=null, conflict=false, rows=[], hold=null, applyHold=null, writing=false, applications=0, uploads=0;
  const calls=[],caps={environment:'sandbox',ocrFileGuard:true};
  const local=createExpenseLocalReview({files:{extract:async()=>{if(hold)await hold;if(extractionError)throw extractionError;return {text:'private invoice text'};},recognize:async()=>recognized,upload:()=>uploads++},
    selected:()=>source,capabilities:()=>caps,editVersion:()=>version,capture:()=>()=>{if(!scoped)throw Error('stale account');},
    apply:async(value,check)=>{if(applyHold)await applyHold;check();applications++;draft=value;},render:()=>{},run:work=>work(),canStart:()=>true,canApply:()=>!writing,ocrActive:()=>false,confirmDialog:async()=>true,
    request:async(action,body,check)=>{check();calls.push({action,body});if(action==='ocr_lookup')return {hasOcrOperation:conflict};
      assert.equal(action,'expenses');const items=rows.filter(row=>row.number===body.number);return {version:1,environment:'sandbox',page:0,pageSize:50,pages:items.length?1:0,total:items.length,items};}});
  const snapshot={number:'0123456789',documentType:305,date:'2026-08-12'},supplier={id:'canonical',taxId:'123456789'};
  return {local,calls,caps,snapshot,supplier,getDraft:()=>draft,getUploads:()=>uploads,edit:()=>{version++;local.edited();},
    switchSource:()=>{source={type:'application/pdf',file:new Blob(['%PDF other file'])};local.reset();},switchAccount:()=>{scoped=false;local.reset();},
    holdApply:value=>applyHold=value,beginWrite:()=>writing=true,applications:()=>applications,conflict:()=>conflict=true,setRows:value=>rows=value,hold:promise=>hold=promise};
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

test('unrecognized and scanned PDFs never fill empty suggestions, remain manual-editable, and still check duplicates',async()=>{
  for (const outcome of ['no_usable_text','unknown_supplier']) {
    const recognized={profile:null,outcome,fields:{invoiceNumber:{value:null,status:'missing'}},warnings:outcome==='no_usable_text'?['no_usable_text']:['unknown_supplier']};
    const f=fixture({recognized});await f.local.start();
    assert.equal(f.getDraft(),null);assert.equal(f.local.blocked(),false);assert.ok(f.local.markup().includes(outcome));
    assert.ok(!f.local.markup().includes('הנתונים מולאו'));assert.ok(!f.local.markup().includes('data-expense-command="local-fill"'));
    await f.local.preflight(f.snapshot,f.supplier,()=>{});assert.ok(f.calls.some(row=>row.action==='expenses'));
  }
});

test('technical extraction errors stay separate from no-text outcomes and do not block checked manual saving',async()=>{
  const f=fixture({extractionError:Error('private internal parser failure')});await f.local.start();
  assert.equal(f.getDraft(),null);assert.equal(f.local.blocked(),false);assert.ok(f.local.markup().includes('extraction_error'));
  assert.ok(f.local.markup().includes('ידנית'));assert.ok(!f.local.markup().includes('private internal'));
  await f.local.preflight(f.snapshot,f.supplier,()=>{});
});

test('manual provenance survives re-recognition and work-draft restoration without automatic replacement',async()=>{
  const f=fixture();await f.local.start();f.local.edited('number');const saved=f.local.snapshot();
  await f.local.start();assert.deepEqual(f.local.snapshot().edits,{number:'manual'});
  f.local.reset();await f.local.restore(saved);assert.deepEqual(f.local.snapshot().edits,{number:'manual'});
  assert.equal(f.local.fieldReview({number:'manual'},'123456789').number.status,'manual');
  await f.local.fill();assert.deepEqual(f.local.snapshot().edits,{});
});

test('explicit partial refill keeps manual provenance for fields absent from the proposal',async()=>{
  const f=fixture();await f.local.start();f.local.edited('allocationNumber');await f.local.fill();
  assert.deepEqual(f.local.snapshot().edits,{allocationNumber:'manual'});
});

test('a late supplier lookup during proposal refill cannot change a form that started financial saving',async()=>{
  const f=fixture();await f.local.start();assert.equal(f.applications(),1);
  let release;f.holdApply(new Promise(resolve=>release=resolve));const work=f.local.fill();
  await new Promise(resolve=>setTimeout(resolve,0));f.beginWrite();release();await work;
  assert.equal(f.applications(),1);assert.match(f.local.markup(),/שמירה/);
});
