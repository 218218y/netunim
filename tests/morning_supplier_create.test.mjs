import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSupplierWriter,supplierInput} from '../netunim-orders/supabase/functions/morning-expenses/supplier-writer.js';
import {createExpenseService} from '../netunim-orders/supabase/functions/morning-expenses/service.js';
import {createExpenseTransport} from '../netunim-orders/supabase/functions/morning-expenses/transport.js';
import {createExpenseSupplierForm} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-supplier-create.js';

const id=n=>'aaaaaaaa-aaaa-4aaa-aaaa-'+String(n).padStart(12,'0');
const user={id:id(1),app_metadata:{morning_expenses_read:true,morning_expenses_write:true}};
const input={name:'ספק לדוגמה',taxId:'012345678'},body={action:'create_supplier',...input};
const supplier={...input,id:id(2),active:true,country:'IL'};
function setup(options={}){
 let row=null,items=options.items||[],posts=0;const calls=[];
 const ledger={get:async()=>row,reserve:async(owner,values)=>row?null:(row={state:'reserved',name:values.name,owner_id:owner}),
  claim:async()=>{if(row.state!=='reserved')return null;row={...row,state:'sending'};return row;},
  verify:async(tax,supplierId)=>{row={...row,state:'verified',supplier_id:supplierId};return row;}};
 const request=async(path,init)=>{
  calls.push({path,init});
  if(path==='/suppliers/search')return {page:1,pageSize:50,total:items.length,pages:items.length?1:0,items};
  if(path==='/suppliers'){
   posts++;if(options.hold)await options.hold;
   if(!options.absent)items=[supplier];if(options.timeout)throw Error('Timeout');return supplier;
  }
  return {...items.find(row=>path.endsWith(row.id)),...options.canonical};
 };
 return {writer:createSupplierWriter({request,ledger,environment:'sandbox',enabled:true,...options.writer}),
  request,ledger,calls,posts:()=>posts,row:()=>row,setItems:value=>{items=value;}};
}
test('supplier input accepts only a bounded name and nine digit identity, preserving leading zeroes',()=>{
 assert.deepEqual(supplierInput({name:' '+input.name+' ',taxId:' '+input.taxId+' ',country:'PS',balanceAmount:200}),input);
 for(const change of [{name:''},{name:'x'.repeat(181)},{name:'bad\nname'},{name:'bad\u202ename'},{taxId:'12345678'},{taxId:123456789},{taxId:'12345x789'}])assert.throws(()=>supplierInput({...input,...change}));
});
test('creation sends only name and taxId, reads canonical defaults and reuses an existing supplier',async()=>{
 const s=setup(),first=await s.writer.handle(user,{...body,country:'PS',active:false,balanceAmount:900});
 assert.equal(first.body.verified,true);assert.equal(first.body.existing,false);assert.equal(s.row().state,'verified');
 assert.deepEqual(JSON.parse(s.calls.find(call=>call.path==='/suppliers').init.body),input);
 assert.equal(JSON.parse(s.calls[0].init.body).active,undefined);
 const again=await s.writer.handle(user,body);assert.equal(again.body.existing,true);assert.equal(s.posts(),1);
});
test('inactive, foreign, ambiguous and mismatched canonical records block creation',async()=>{
 for(const [items,canonical,code] of [[[ {...supplier,active:false}],{},'supplier_inactive'],[[{...supplier,country:'PS'}],{},'supplier_country'],
  [[supplier,{...supplier,id:id(3)}],{},'supplier_identity_ambiguous'],[[supplier],{taxId:'999999999'},'morning_supplier_unavailable']]){
  const s=setup({items,canonical}),value=await s.writer.handle(user,body);
  assert.equal(value.body.code,code);assert.equal(s.posts(),0);
 }
});
test('concurrent requests share one persistent send claim and an uncertain POST is never replayed',async()=>{
 let release;const hold=new Promise(resolve=>{release=resolve;});
 const s=setup({hold,timeout:true,absent:true});
 const first=s.writer.handle(user,body);
 while(!s.posts())await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal((await s.writer.handle(user,body)).status,202);assert.equal(s.posts(),1);
 release();assert.equal((await first).status,202);
 assert.equal((await s.writer.handle(user,body)).status,202);assert.equal(s.posts(),1);
 assert.equal((await s.writer.handle(user,{...body,action:'supplier_status'})).body.pending,true);
 s.setItems([supplier]);const recovered=await s.writer.handle(user,{...body,action:'supplier_status'});
 assert.equal(recovered.body.verified,true);assert.equal(s.posts(),1);
});
test('readers, editable metadata, non-pilot production users and disabled writes cannot create suppliers',async()=>{
 for(const account of [null,{id:id(1),app_metadata:{morning_expenses_read:true}},{id:id(1),user_metadata:{morning_expenses_write:true}}]){
  const s=setup();assert.equal((await s.writer.handle(account,body)).status,403);assert.equal(s.calls.length,0);
 }
 for(const config of [{enabled:false},{environment:'production',productionUserId:id(3)}]){
  const s=setup({writer:config});assert.equal((await s.writer.handle(user,body)).status,403);assert.equal(s.calls.length,0);
 }
});
test('supplier commands require the displayed environment and independent server write permission',async()=>{
 const s=setup(),service=createExpenseService({request:s.request,environment:'sandbox',supplierWriter:s.writer});
 assert.equal((await service(user,{action:'capabilities'})).body.createSupplier,true);
 for(const action of ['create_supplier','supplier_status'])for(const expectedEnvironment of [undefined,'production','typo']){
  assert.equal((await service(user,{...body,action,expectedEnvironment})).status,409);
 }
 assert.equal(s.calls.length,0);
 const result=await service(user,{...body,expectedEnvironment:'sandbox'});
 assert.equal(result.body.version,1);assert.equal(result.body.environment,'sandbox');assert.equal(result.body.verified,true);
});
test('supplier POST authentication failures and throttles are never replayed by the transport',async()=>{
 for(const status of [401,429]){
  let posts=0;
  const request=createExpenseTransport({environment:'sandbox',clientId:'test',clientSecret:'test',fetch:async url=>{
   if(url.includes('oauth/token'))return Response.json({access_token:'test',expires_in:3600});
   posts++;return Response.json({},{status});
  }});
  await assert.rejects(request('/suppliers',{method:'POST',body:JSON.stringify(input)}));assert.equal(posts,1);
 }
});
test('supplier form retains uncertain results for lookup, rejects stale scopes and never auto-posts',async()=>{
 const prior=globalThis.document;globalThis.document={querySelector:()=>null};
 let state='live',busy=false,reply={verified:false,pending:true},chosen=null;const calls=[];
 const form=createExpenseSupplierForm({capabilities:()=>({environment:'sandbox',createSupplier:true}),editable:()=>!busy,
  capture:()=>()=>{if(state!=='live')throw Error('stale');},run:async work=>{busy=true;try{return await work();}finally{busy=false;}},
  render:()=>{},choose:item=>{chosen=item;return true;},request:async(action,payload,check)=>{calls.push({action,payload});check();return reply;}});
 form.open();form.field({dataset:{expenseSupplierField:'name'},value:input.name});form.field({dataset:{expenseSupplierField:'taxId'},value:input.taxId});
 await form.submit();assert.equal(calls[0].action,'create_supplier');assert.match(form.markup(false),/readonly/);
 reply={verified:true,existing:true,item:supplier};await form.submit();assert.equal(calls[1].action,'supplier_status');assert.equal(chosen,supplier);
 form.field({dataset:{expenseSupplierField:'name'},value:input.name});form.field({dataset:{expenseSupplierField:'taxId'},value:input.taxId});
 state='changed';await assert.rejects(form.submit(),/stale/);assert.equal(chosen,supplier);globalThis.document=prior;
});
