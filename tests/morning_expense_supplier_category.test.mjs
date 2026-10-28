import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expenseSupplierCategory,readExpenseSupplierCategory} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-catalog.js';

const supplier={id:'supplier-one',taxId:'123456782'},caps={version:1,environment:'production'};
const expense=(n,extra={})=>({id:'expense-'+n,kind:'expense',supplierId:supplier.id,supplierTaxId:'',status:20,sourceDocumentDate:'2026-04-12',classification:{id:'communication',title:'תקשורת'},...extra});
const paged=(items,page)=>({...caps,page,pageSize:50,total:items.length,pages:Math.ceil(items.length/50),items:items.slice(page*50,page*50+50)});

test('supplier-specific category lookup finds older history beyond the global suggestions without financial calls',async()=>{
 const items=Array.from({length:51},(_,n)=>expense(n,{classification:n===50?{id:'goods',title:'סחורה'}:null})),calls=[];
 const result=await readExpenseSupplierCategory(async(action,body,check)=>{check();calls.push({action,body});return paged(items,body.page);},caps,supplier,()=>{});
 assert.equal(result.category.id,'expense-50');assert.equal(result.rows.length,51);
 assert.deepEqual(calls.map(r=>r.action),['expenses','expenses']);
 assert.ok(calls.every(r=>r.body.supplierId===supplier.id&&r.body.expectedEnvironment==='production'&&r.body.fromDate===undefined));
});
test('category proposals exclude deleted records, conflicting identity and same-date competing categories',()=>{
 const old=expense(1,{sourceDocumentDate:'2026-03-01'}),latest=expense(2);
 assert.equal(expenseSupplierCategory([old,latest,expense(3,{status:100})],supplier),latest);
 for(const row of [expense(4,{supplierId:'other'}),expense(4,{supplierTaxId:'987654324'})])assert.equal(expenseSupplierCategory([row],supplier),null);
 assert.equal(expenseSupplierCategory([latest,expense(5,{classification:{id:'different'}})],supplier),null);
 assert.equal(expenseSupplierCategory([expense(6,{supplierId:'',supplierTaxId:supplier.taxId})],supplier).id,'expense-6');
});
test('incomplete, changing, repeated and cross-supplier history cannot establish a category',async()=>{
 for(const mode of ['large','changed','repeat','wrongSupplier','wrongTax','environment']){
  const items=Array.from({length:51},(_,n)=>expense(n));
  await assert.rejects(readExpenseSupplierCategory(async(_action,body)=>{
   const result=paged(items,body.page);
   if(mode==='large'){result.total=201;result.pages=5;}
   if(mode==='changed'&&body.page===1){result.total=52;result.items.push(expense(52));}
   if(mode==='repeat'&&body.page===1)result.items=[items[0]];
   if(mode==='wrongSupplier')result.items[0]={...items[0],supplierId:'other'};
   if(mode==='wrongTax')result.items[0]={...items[0],supplierTaxId:'987654324'};
   if(mode==='environment')result.environment='sandbox';
   return result;
  },caps,supplier,()=>{}),undefined,mode);
 }
});
test('late supplier history is fenced by the caller ownership check',async()=>{
 let current=true;
 await assert.rejects(readExpenseSupplierCategory(async()=>{current=false;return paged([expense(1)],0);},caps,supplier,()=>{if(!current)throw Error('stale form');}),/stale form/);
});
