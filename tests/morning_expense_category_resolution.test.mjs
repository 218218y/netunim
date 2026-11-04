import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveExpenseSupplierCategory} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-catalog.js';
import {readExpenseProposal} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-proposal.js';
import {expenseCategoryRows,retainExpenseCategoryEvidence} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-category-state.js';

const supplier={id:'supplier-one',name:'ספק בדיקה',taxId:'123456782',active:true,country:'IL'};
const capabilities={version:1,environment:'production'};
const expense=(id,extra={})=>({id,kind:'expense',status:10,name:supplier.name,supplierId:'',supplierTaxId:'',sourceDocumentDate:'2026-10-29',classification:{id:'goods',title:'קניות סחורה בארץ'},...extra});
const page=(items,n=0)=>({...capabilities,page:n,pageSize:50,pages:Math.ceil(items.length/50),total:items.length,items:items.slice(n*50,n*50+50)});
test('canonical category evidence replaces its search snapshot in both category choices and the selected expense',()=>{
 const snapshot=expense('same'),canonical={...snapshot,supplierTaxId:supplier.taxId,classification:{id:'verified',title:'סיווג מאומת'}};
 const catalog={expenses:[snapshot]};
 const retained=retainExpenseCategoryEvidence(catalog,[],[canonical]);
 assert.deepEqual(expenseCategoryRows(catalog,retained),[canonical]);
 assert.deepEqual(catalog.classifications.map(row=>row.id),['verified']);
});
test('identity-free search snapshots are resolved by canonical expense tax identity beyond the first page',async()=>{
 const target=expense('target'),items=[...Array.from({length:50},(_,i)=>expense('other-'+i,{name:'אחר'})),target],calls=[];
 const request=async(action,body)=>{
  calls.push({action,body});
  if(action==='get_expense')return {...capabilities,item:{...target,supplierTaxId:supplier.taxId}};
  return page(body.supplierId?[]:items,body.page);
 };
 const result=await resolveExpenseSupplierCategory(request,capabilities,supplier,[],()=>{});
 assert.equal(result.category?.id,'target');assert.equal(result.category.supplierTaxId,supplier.taxId);
 assert.equal(calls.filter(row=>row.action==='get_expense').length,1);
 assert.ok(calls.every(row=>['expenses','get_expense'].includes(row.action)));
});
test('a matching name is only a search hint; conflicting canonical tax identity cannot establish a category',async()=>{
 const target=expense('target');
 const result=await resolveExpenseSupplierCategory(async(action,body)=>action==='get_expense'?{...capabilities,item:{...target,supplierTaxId:'987654324'}}:page(body.supplierId?[]:[target],body.page),capabilities,supplier,[],()=>{});
 assert.equal(result.category,null);
});
test('local invoice fill uses the same saved category preference as manual supplier selection',async()=>{
 const saved=expense('saved',{classification:{id:'chosen',title:'סיווג שנבחר'}}),latest=expense('latest',{supplierId:supplier.id,supplierTaxId:supplier.taxId});
 const result=await readExpenseProposal({supplier:{taxId:supplier.taxId}},{
  request:async()=>page([supplier]),capabilities,canonicalItem:async(action,id)=>action==='get_supplier'?supplier:{...saved,id},
  expenses:[latest],preferences:{classifications:[{supplierId:supplier.id,expenseId:saved.id}]},local:true,check:()=>{},
 });
 assert.equal(result.category?.classification.id,'chosen');
});

test('snapshot history refuses changing pages, invalid details and stale ownership instead of guessing a category',async()=>{
 const target=expense('target');
 for(const mode of ['wrong-id','wrong-environment','unavailable','stale']){
  let current=true;
  await assert.rejects(resolveExpenseSupplierCategory(async(action,body)=>{
   if(action!=='get_expense')return page(body.supplierId?[]:[target]);
   if(mode==='unavailable')throw Error('offline');
   if(mode==='stale')current=false;
   return {...capabilities,environment:mode==='wrong-environment'?'sandbox':'production',
    item:{...target,id:mode==='wrong-id'?'other':target.id,supplierTaxId:supplier.taxId}};
  },capabilities,supplier,[],()=>{if(!current)throw Error('stale');}),undefined,mode);
 }
 const items=[...Array.from({length:50},(_,i)=>expense('other-'+i,{name:'אחר'})),target];
 await assert.rejects(resolveExpenseSupplierCategory(async(_action,body)=>{
  if(body.supplierId)return page([]);
  const result=page(items,body.page);if(body.page)result.total=52;return result;
 },capabilities,supplier,[],()=>{}));
});

test('all matching canonical records participate in same-date category conflicts and deleted details are excluded',async()=>{
 const items=[expense('first'),expense('second')];
 for(const deleted of [false,true]){
  const result=await resolveExpenseSupplierCategory(async(action,body)=>{
   if(action!=='get_expense')return page(body.supplierId?[]:items);
   return {...capabilities,item:{...items.find(row=>row.id===body.id),supplierTaxId:supplier.taxId,
    ...(body.id==='second'?{status:deleted?100:10,classification:{id:'different',title:'אחר'}}:{})}};
  },capabilities,supplier,[],()=>{});
  assert.equal(result.category?.id||null,deleted?'first':null);
 }
});
