import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createExpenseBatch} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-batch.js';
import {createExpenseBatchRecovery} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-batch-recovery.js';
import {executeExpenseJob} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-job.js';
import {normalizeExpenseInput} from '../netunim-orders/site/assets/js/core/morning-expense-input.js';
import {createRuntimeTaskOwner} from '../netunim-orders/site/assets/js/shared/runtime-task-owner.js';
const id=n=>'aaaaaaaa-aaaa-4aaa-aaaa-'+String(n).padStart(12,'0'),sha=n=>String(n).padStart(64,'0');
function memory(){const values=new Map();return {get length(){return values.size;},key:n=>[...values.keys()][n]??null,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};}
function fixture(){
 const storage=memory(),tasks=createRuntimeTaskOwner(),events=[],detached=[],restored=[];let owner=id(1),blocked=false,mode='',held=false,execute=async(entry,check)=>{check();events.push(entry.operationId);return {verified:true,sourceVerified:true};};
 const options={storage:()=>storage,capture:()=>{const saved=owner;return()=>assert.equal(owner,saved,'old account');},request:async()=>{if(mode==='missing')throw Object.assign(Error('missing'),{code:'morning_expense_operation_missing'});return {verified:true};},confirmDialog:async()=>true,run:tasks.run,render:()=>{},report:()=>{},toast:()=>{},detach:list=>detached.push(...list),pending:()=>false,
  execute:(...args)=>execute(...args),openRecovery:async op=>events.push('read:'+op),restoreUnsent:entry=>restored.push(entry),progress:()=>{},settled:()=>{},
  locks:{request:async(_,__,work)=>{if(blocked||held)return work(null);held=true;try{return await work({});}finally{held=false;}}}};
 const batch=createExpenseBatch(options);batch.initialize(owner,'production');
 const mark=n=>{
  const item={name:'private-invoice-'+n+'.pdf',file:new File(['%PDF-1.4 '+n],n+'.pdf',{type:'application/pdf'}),type:'application/pdf'};
  return batch.mark(item,{draft:{number:'PRIVATE-000'+n},local:{proposal:null,edits:{}}},{sourceFile:{sha256:sha(n),size:item.file.size,contentType:item.type},sourceReview:{}},{number:'PRIVATE-000'+n});
 };
 return {batch,storage,tasks,mark,events,detached,restored,options,setExecute:value=>execute=value,setMode:value=>mode=value,block:value=>blocked=value,account:value=>owner=value};
}
test('approval alone is private, immutable, scoped metadata and does not dispatch; edits revoke approval',async()=>{
 const f=fixture(),entry=f.mark(1);assert.equal(f.events.length,0);assert.equal(f.batch.count(),1);
 const saved=[...f.storage.values.values()].join('');assert.ok(!saved.includes('PRIVATE')&&!saved.includes('private-invoice'));
 assert.equal(JSON.parse(saved).state,'approved');assert.equal(createExpenseBatchRecovery(f.storage,id(2),'production').list().length,0);
 f.batch.invalidate(entry.item);assert.equal(f.batch.count(),0);assert.equal(f.storage.length,0);
});
test('single background saves and approved batches share one serial worker while new approvals remain available',async()=>{
 const f=fixture();let release,active=0,maxActive=0;const hold=new Promise(resolve=>release=resolve);
 f.setExecute(async(entry,check)=>{active++;maxActive=Math.max(active,maxActive);f.events.push(entry.operationId);if(f.events.length===1)await hold;check();active--;return {verified:true,sourceVerified:true};});
 const first=f.mark(1);f.batch.enqueue([first]);await new Promise(resolve=>setTimeout(resolve,0));
 const second=f.mark(2),third=f.mark(3);await f.batch.send();assert.equal(f.events.length,1);assert.equal(f.detached.length,3);
 release();await f.tasks.drain();assert.deepEqual(f.events,[first.operationId,second.operationId,third.operationId]);assert.equal(maxActive,1);assert.equal(f.storage.length,0);assert.equal(f.batch.files().length,0);
});
test('failure pauses later work, survives reload, and recovery only reads existing financial state',async()=>{
 const f=fixture(),first=f.mark(1),second=f.mark(2);f.setExecute(async entry=>{f.events.push(entry.operationId);throw Error('unknown upload');});
 await f.batch.send();await f.tasks.drain();assert.deepEqual(f.events,[first.operationId]);assert.equal(f.batch.paused(),true);
 const rows=createExpenseBatchRecovery(f.storage,id(1),'production').list();assert.deepEqual(rows.map(row=>row.state),['attention','queued']);
 const recovered=createExpenseBatch(f.options);recovered.initialize(id(1),'production');assert.ok(recovered.markup(false).includes('מעקב קודם'));assert.equal(recovered.kick(),false);
 await recovered.recover(first.operationId);assert.equal(f.events[1],'read:'+first.operationId);assert.equal(f.events.filter(x=>!x.startsWith('read:')).length,1);
 f.setMode('missing');await f.batch.recover(second.operationId);assert.equal(f.restored[0].operationId,second.operationId);assert.equal(f.storage.length,1);
});
test('storage failure prevents approval and dispatch; lock contention leaves a visible queued item for explicit resume',async()=>{
 const f=fixture(),original=f.storage.setItem;f.storage.setItem=()=>{throw Error('storage blocked');};assert.throws(()=>f.mark(1),/storage blocked/);assert.equal(f.events.length,0);
 f.storage.setItem=original;const entry=f.mark(2);f.block(true);f.batch.enqueue([entry]);await f.tasks.drain();assert.equal(f.events.length,0);assert.equal(f.batch.paused(),true);assert.equal(JSON.parse([...f.storage.values.values()][0]).state,'queued');
 f.block(false);await f.batch.resume();await f.tasks.drain();assert.deepEqual(f.events,[entry.operationId]);
});
test('a double batch click opens one confirmation and dispatches one approved set',async()=>{
 const f=fixture();let release,confirms=0;const hold=new Promise(resolve=>release=resolve);
 f.options.confirmDialog=async()=>{confirms++;return hold;};
 const batch=createExpenseBatch(f.options);batch.initialize(id(1),'production');
 const original=f.mark(1);f.batch.invalidate(original.item);batch.mark(original.item,original.saved,original.source,original.snapshot);
 const sending=batch.send();assert.equal(batch.send(),false);assert.equal(confirms,1);release(true);await sending;await f.tasks.drain();assert.equal(f.events.length,1);
});
test('partial metadata failure dispatches nothing and retains queued and approved work',async()=>{
 const f=fixture(),first=f.mark(1),second=f.mark(2),write=f.storage.setItem;
 f.storage.setItem=(key,value)=>{if(key.endsWith(second.operationId)&&JSON.parse(value).state==='queued')throw Error('quota');write(key,value);};
 await f.batch.send();await f.tasks.drain();assert.equal(f.events.length,0);assert.equal(f.batch.paused(),true);assert.equal(f.batch.files().length,2);assert.equal(f.storage.length,2);
 assert.equal(f.batch.label(first.item),'במעקב שליחה');assert.equal(f.batch.label(second.item),'מאושרת לשליחה');
});
test('account cutover stops the next dispatch and retains original-account operation metadata',async()=>{
 const f=fixture();let release;const hold=new Promise(resolve=>release=resolve);
 f.setExecute(async(entry,check)=>{f.events.push(entry.operationId);await hold;check();return {verified:true,sourceVerified:true};});
 const first=f.mark(1);f.mark(2);await f.batch.send();f.account(id(2));f.batch.initialize(id(2),'production');release();await f.tasks.drain();
 assert.deepEqual(f.events,[first.operationId]);assert.equal(f.batch.files().length,0);assert.equal(createExpenseBatchRecovery(f.storage,id(1),'production').list().length,2);
});

const draft={supplierId:id(3),classificationExpenseId:id(4),documentType:305,number:'00123',date:'2026-10-20',reportingDate:'2026-10-01',net:'1000.00',vat:'160.00',gross:'1160.00',pcnClassification:'T',description:''};
test('detached job preserves reviewed fields and bytes through canonical checks and the existing source completion',async()=>{
 const f=fixture(),entry=f.mark(1);entry.snapshot=structuredClone(draft);entry.saved.supplier={id:id(3),taxId:'123456789'};entry.saved.classification={id:id(4),classification:{id:id(5)}};
 const calls=[];let result;
 await executeExpenseJob(entry,{capabilities:{environment:'production',create:true,sourceIntent:true,duplicateCheck:true,ocrFileGuard:true,upload:true,sourceRelay:true},today:'2026-10-29',check:()=>{},upload:()=>assert.fail('direct upload'),progress:()=>{},financial:value=>{result=value;},
  request:async(action,body)=>{calls.push(action);assert.equal(body.operationId,entry.operationId);assert.equal(body.expectedEnvironment,'production');
   if(action==='get_supplier')return {item:entry.saved.supplier.active===false?entry.saved.supplier:{...entry.saved.supplier,active:true}};
   if(action==='get_expense')return {item:{...entry.saved.classification,status:10}};
   if(action==='ocr_lookup')return {hasOcrOperation:false};if(action==='duplicate_check')return {duplicate:false};
   if(action==='create'){assert.deepEqual(body.expense,draft);return {verified:true,sourceExpected:true,sourceMetadata:entry.source.sourceFile};}
   assert.fail(action);
  },sourceCompletion:async args=>{assert.equal(args.selected.file,entry.item.file);assert.deepEqual(await args.prepare(()=>{}),entry.source);args.accept({...args.result,sourceVerified:true});return true;}});
 assert.equal(calls.filter(action=>action==='create').length,1);assert.equal(result.verified,true);assert.equal(entry.result.sourceVerified,true);
});
test('required fields, exact money and date-dependent allocation presence block approval before any write',()=>{
 const normalize=values=>normalizeExpenseInput({operationId:id(2),expense:{...draft,...values}},'2026-10-29',{allowP:true});
 assert.throws(()=>normalize({number:''}),/invalid_expense_input/);assert.throws(()=>normalize({date:''}),/invalid_expense_input/);assert.throws(()=>normalize({gross:'1160.01'}),/invalid_expense_amounts/);
 assert.throws(()=>normalize({net:'5000.01',vat:'900.00',gross:'5900.01'}),/expense_allocation_required/);
 assert.equal(normalize({net:'5000.00',vat:'900.00',gross:'5900.00'}).allocationNumber,'');
 assert.equal(normalize({date:'2026-01-20',net:'6000.00',vat:'1080.00',gross:'7080.00'}).allocationNumber,'');
 assert.equal(normalize({documentType:330,net:'6000.00',vat:'1080.00',gross:'7080.00'}).documentType,330);
 assert.equal(normalize({pcnClassification:'P',net:'6000.00',vat:'960.00',gross:'6960.00'}).vatCents,96000);
 assert.equal(normalize({net:'6000.00',vat:'1080.00',gross:'7080.00',allocationNumber:'123456789'}).allocationNumber,'123456789');
});
