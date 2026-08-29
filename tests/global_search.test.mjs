import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGlobalSearchEntries,normalizeGlobalSearchText,searchGlobalData} from '../netunim-orders/site/assets/js/domains/search/model.js';

const state={
 suppliers:[{id:'S1',name:'אלפא רהיטים',note:'ספק ראשי'}],
 transactions:[{id:'T1',supplierId:'S1',sequence:7,action:'הזמנת ארון',debit:1500,credit:0,supplyInfo:'אספקה ירושלים',note:'דחוף',source:{sheet:'ספקים',row:42}}],
 customerDebts:[{id:'D1',customerName:'משה כהן',orderNumber:'8123',phone:'050-123-4567',amount:900,note:'יתרה אחרונה',paid:false,supplied:true,invoiceIssued:false}],
 customerOrders:[{id:'O1',customerName:'משה כהן',orderNumber:'8123',note:'מזרן זוגי',mattressMarked:true}],
 serviceCalls:[{id:'SV1',customerName:'משה כהן',orderNumber:'8123',phone:'050-123-4567',description:'תיקון דלת',address:'ירושלים',closed:false}],
 checks:[{id:'C1',name:'משה כהן',amount:900,dueDate:'2026-09-10',status:'בקופה',checkNumber:'00177',note:'עבור 8123'}],
 inventoryItems:[{id:'I1',name:'מזרן אורטופדי',category:'מזרנים',defaultLocation:'מחסן גדול',active:true,note:''}],
 inventoryEvents:[{id:'E1',itemId:'I1',type:'reserve',quantity:1,customerName:'משה כהן',location:'מחסן גדול',note:'עבור הזמנה 8123',createdAt:'2026-08-29'}],
 warehouseOrders:[{id:'W1',customerName:'משה כהן',phone:'0501234567',details:'מזרן אורטופדי',location:'מחסן קטן',status:'ordered',note:'8123'}],
 notes:[{id:'N1',content:'להתקשר למשה כהן לגבי הזמנה 8123',createdAt:'2026-08-29',updatedAt:'2026-08-29'}]
};

test('global search builds entries for every operational Orders repository',()=>{
 const entries=buildGlobalSearchEntries(state);
 assert.deepEqual(new Set(entries.map(x=>x.group)),new Set(['suppliers','customers','service','checks','warehouse','notes']));
 assert.ok(entries.some(x=>x.kind==='supplier-transaction'&&x.id==='T1'));
 assert.ok(entries.some(x=>x.kind==='inventory-event'&&x.id==='E1'));
});

test('global search spans modules for the same customer and keeps repository grouping',()=>{
 const result=searchGlobalData(state,'משה כהן');
 assert.ok(result.total>=7);
 const counts=Object.fromEntries(result.groups.map(x=>[x.key,x.total]));
 assert.ok(counts.customers>=2);assert.ok(counts.service>=1);assert.ok(counts.checks>=1);assert.ok(counts.warehouse>=2);assert.ok(counts.notes>=1);
});

test('global search normalizes punctuation, phone separators and money formatting',()=>{
 assert.equal(normalizeGlobalSearchText('  050-123/4567  '),'050 123 4567');
 assert.ok(searchGlobalData(state,'0501234567').total>=3);
 assert.ok(searchGlobalData(state,'1,500').groups.find(x=>x.key==='suppliers').items.some(x=>x.id==='T1'));
});

test('supplier name ranks the supplier card ahead of its matching transactions',()=>{
 const group=searchGlobalData(state,'אלפא רהיטים').groups.find(x=>x.key==='suppliers');
 assert.equal(group.items[0].kind,'supplier');
 assert.equal(group.items[0].id,'S1');
 assert.ok(group.items.some(x=>x.kind==='supplier-transaction'&&x.id==='T1'));
});

test('global search scans all matches before applying per-group render limits',()=>{
 const many={...state,notes:Array.from({length:9},(_,i)=>({id:'N'+i,content:'חיפוש משותף '+i}))};
 const group=searchGlobalData(many,'חיפוש משותף',{limitPerGroup:3}).groups.find(x=>x.key==='notes');
 assert.equal(group.total,9);assert.equal(group.items.length,3);
});
