import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supplierSearchMatch} from '../netunim-orders/site/assets/js/core/morning-supplier-search.js';
import {searchMatch} from '../netunim-orders/site/assets/js/core/search.js';
import {searchExpenseSuppliers} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-catalog.js';

test('Hebrew name aliases are symmetric and retain canonical supplier identity',()=>{
 for(const [first,second]of [['חרבאווי','חרבאוי'],['חיים','חים'],['ת.ב.י.','תבי']]){
  const supplier=Object.freeze({id:'one',name:first,taxId:'123456789'});
  assert.equal(supplierSearchMatch(second,supplier),true);assert.equal(supplierSearchMatch(first,{name:second}),true);
  assert.equal(supplierSearchMatch(second+' 123456789',supplier),true);
  assert.equal(supplierSearchMatch(second+' 987654321',supplier),false);
  assert.equal(supplier.name,first);assert.equal(supplier.taxId,'123456789');
 }
 assert.equal(supplierSearchMatch('חרבאווי',{name:'חרבון'}),false);
 assert.equal(supplierSearchMatch('אלון',{name:'אלן'}),false);
 assert.equal(searchMatch('חרבאווי',['חרבאוי']),false,'ordinary search and identifier matching stay unchanged');
 const fields=['חרבאוי','תיאור','123456789'];
 assert.equal(supplierSearchMatch('חרבאווי 1',{name:'חרבאוי'},fields),false,'short numeric tokens retain the original multi-token rules');
 assert.equal(supplierSearchMatch('חרבאווי 123456789',{name:'חרבאוי'},fields),true);
 const suppliers=[{id:'one',name:'חרבאוי'},{id:'two',name:'חרבאווי'}];
 assert.deepEqual(suppliers.filter(row=>supplierSearchMatch('חרבאווי',row)).map(row=>row.id),['one','two']);
});

test('name variants beyond strict remote results use bounded canonical directory pages',async()=>{
 const caps={version:1,environment:'sandbox'};
 const rows=Array.from({length:101},(_,n)=>({id:String(n),name:n===100?'חרבאוי':'ספק אחר',taxId:'123456789',active:true}));
 const page=index=>({...caps,page:index,pageSize:50,pages:3,total:101,items:rows.slice(index*50,index*50+50)});
 const catalog={capabilities:caps,supplierPage:page(0)},calls=[];
 const request=async(_,body)=>{calls.push(body);return body.name?{...caps,page:0,pageSize:50,pages:0,total:0,items:[]}:page(body.page)};
 const found=await searchExpenseSuppliers(request,catalog,'חרבאווי',false,()=>{});
 assert.equal(found.items.length,1);assert.equal(found.items[0].id,'100');assert.equal(found.items[0].name,'חרבאוי');
 assert.deepEqual(calls.map(row=>row.page),[0,1,2]);
 await searchExpenseSuppliers(request,catalog,'חרבאוויי',false,()=>{});assert.equal(calls.length,4);
});
