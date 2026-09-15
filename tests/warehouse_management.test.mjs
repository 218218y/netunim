import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyBulkRangeSelection} from '../netunim-orders/site/assets/js/ui/bulk-selection.js';
import {createStateNormalization} from '../netunim-orders/site/assets/js/state/normalization.js';
import {createDomainsWarehouseView} from '../netunim-orders/site/assets/js/domains/warehouse/view.js';
import {
  WAREHOUSE_LOCATIONS,
  inventoryItemLocationsData,
  inventoryHistoryDeletePlan,
  inventoryStatsData,
  inventoryLocationStatsData,
  inventoryTransferProblem,
  inventoryStockStatus,
  inventorySearchMatch,
  inventoryCanArchiveData,
} from '../netunim-orders/site/assets/js/domains/inventory/model.js';

test('warehouse fixed locations include unknown in the requested order',()=>{
  assert.deepEqual(WAREHOUSE_LOCATIONS,['מחסן קטן','מחסן גדול','מקלט','לא ידוע']);
  const state={inventoryEvents:[
    {id:'e1',itemId:'legacy',type:'receive',quantity:1,location:'מחסן גדול',createdAt:'2026-01-01'},
    {id:'e2',itemId:'explicit',type:'receive',quantity:1,location:'מקלט',createdAt:'2026-01-01'},
  ]};
  assert.deepEqual(inventoryItemLocationsData(state,{id:'small',defaultLocation:'מחסן   קטן'}),['מחסן קטן']);
  assert.deepEqual(inventoryItemLocationsData(state,{id:'legacy',defaultLocation:'מדף ישן'}),['מחסן גדול']);
  // Physical event locations take precedence over catalog defaults.
  assert.deepEqual(inventoryItemLocationsData(state,{id:'explicit',defaultLocation:'לא ידוע'}),['מקלט']);
  assert.deepEqual(inventoryItemLocationsData(state,{id:'none',defaultLocation:''}),['לא ידוע']);
});

test('shift bulk selection selects the visible inclusive range and keeps the anchor',()=>{
  const selected=new Set();
  let anchor=applyBulkRangeSelection({selected,orderedIds:['a','b','c','d','e'],id:'b',checked:true});
  assert.equal(anchor,'b');
  anchor=applyBulkRangeSelection({selected,orderedIds:['a','b','c','d','e'],id:'e',checked:true,shiftKey:true,anchorId:anchor});
  assert.equal(anchor,'b');
  assert.deepEqual([...selected],['b','c','d','e']);
  anchor=applyBulkRangeSelection({selected,orderedIds:['a','b','c','d','e'],id:'d',checked:false,shiftKey:true,anchorId:anchor});
  assert.equal(anchor,'b');
  assert.deepEqual([...selected],['e']);
});


test('bulk row selection is idempotent across click and change for the same gesture',()=>{
  const selected=new Set();
  let anchor=applyBulkRangeSelection({selected,orderedIds:['a','b','c'],id:'a',checked:true});
  assert.equal(anchor,'a');
  anchor=applyBulkRangeSelection({selected,orderedIds:['a','b','c'],id:'a',checked:true,anchorId:anchor});
  assert.equal(anchor,'a');
  assert.deepEqual([...selected],['a']);
  anchor=applyBulkRangeSelection({selected,orderedIds:['a','b','c'],id:'c',checked:true,shiftKey:true,anchorId:anchor});
  assert.equal(anchor,'a');
  assert.deepEqual([...selected],['a','b','c']);
  anchor=applyBulkRangeSelection({selected,orderedIds:['a','b','c'],id:'c',checked:true,anchorId:anchor});
  assert.equal(anchor,'a');
  assert.deepEqual([...selected],['a','b','c']);
});

test('history cleanup blocks active operational rows',()=>{
  const state={inventoryEvents:[
    {id:'incoming',itemId:'i1',type:'order',quantity:4,receivedQuantity:1},
    {id:'reserved',itemId:'i1',type:'reserve',quantity:1},
    {id:'closed',itemId:'i1',type:'adjust',quantity:2},
  ]};
  const plan=inventoryHistoryDeletePlan(state,['incoming','closed']);
  assert.deepEqual(plan.blockedIds,['incoming']);
  assert.deepEqual(plan.deletableIds,[]);
  assert.equal(plan.effects.size,0);
});

test('history cleanup plan can compact closed rows without changing on-hand inventory',()=>{
  const state={inventoryEvents:[
    {id:'open',itemId:'i1',type:'opening',quantity:10},
    {id:'recv',itemId:'i1',type:'receive',quantity:2},
    {id:'adj',itemId:'i1',type:'adjust',quantity:-1},
    {id:'picked-reserve',itemId:'i1',type:'reserve',quantity:3,pickedAt:'2026-01-01'},
    {id:'legacy-pickup',itemId:'i1',type:'pickup',quantity:2},
    {id:'done-order',itemId:'i1',type:'order',quantity:5,receivedQuantity:5,receivedAt:'2026-01-01'},
  ]};
  const before=inventoryStatsData(state,'i1');
  const ids=state.inventoryEvents.map(row=>row.id);
  const plan=inventoryHistoryDeletePlan(state,ids);
  assert.deepEqual(plan.blockedIds,[]);
  assert.equal(plan.effects.get('i1'),6);
  const deleted=new Set(plan.deletableIds);
  const compacted={inventoryEvents:state.inventoryEvents.filter(row=>!deleted.has(row.id))};
  compacted.inventoryEvents.push({id:'carry',itemId:'i1',type:'adjust',quantity:plan.effects.get('i1'),historyCompaction:true});
  const after=inventoryStatsData(compacted,'i1');
  assert.equal(after.onHand,before.onHand);
  assert.equal(after.reserved,before.reserved);
  assert.equal(after.incoming,before.incoming);
  assert.equal(after.available,before.available);
});

test('split receipts, reservations, pickups and transfers conserve every total',()=>{
  const state={inventoryItems:[{id:'i',defaultLocation:'מחסן גדול'}],inventoryEvents:[
    {id:'a',itemId:'i',type:'opening',quantity:8,location:'מחסן גדול'},
    {id:'b',itemId:'i',type:'transfer',quantity:3,fromLocation:'מחסן גדול',toLocation:'מקלט'},
    {id:'c',itemId:'i',type:'order',quantity:4,receivedQuantity:2,location:'מחסן קטן'},
    {id:'d',itemId:'i',type:'receive',quantity:2,location:'מקלט',sourceOrderId:'c'},
    {id:'e',itemId:'i',type:'reserve',quantity:2,location:'מקלט'},
    {id:'f',itemId:'i',type:'reserve',quantity:1,location:'מחסן גדול',pickedAt:'2026-09-01'},
  ]};
  const by=inventoryLocationStatsData(state,'i');
  assert.equal(by['מחסן גדול'].onHand,4);
  assert.equal(by['מקלט'].onHand,5);
  assert.equal(by['מקלט'].available,3);
  assert.equal(by['מחסן קטן'].incoming,2);
  for(const key of ['onHand','reserved','incoming','available','projected'])assert.equal(Object.values(by).reduce((n,s)=>n+s[key],0),inventoryStatsData(state,'i')[key],key);
  assert.equal(inventoryTransferProblem(state,'i','מקלט','מחסן גדול',4).length>0,true,'reserved stock is protected');
  assert.equal(inventoryTransferProblem(state,'i','מקלט','מחסן גדול',3),'');
  assert.ok(inventoryTransferProblem(state,'i','מקלט','מקלט',1));
  assert.ok(inventoryTransferProblem(state,'i','מקלט','מחסן קטן',-1));
});

test('legacy unallocated stock does not move when the catalog default is edited',()=>{
  const state={inventoryItems:[{id:'i',defaultLocation:'מחסן קטן'}],inventoryEvents:[
    {id:'a',itemId:'i',type:'opening',quantity:7},
    {id:'b',itemId:'i',type:'receive',quantity:2,location:'מחסן קטן / מחסן גדול'},
    {id:'c',itemId:'i',type:'adjust',quantity:-1,location:'מדף ישן'},
  ]};
  const before=inventoryLocationStatsData(state,'i');
  assert.equal(before['לא ידוע'].onHand,8);
  state.inventoryItems[0].defaultLocation='מקלט';
  assert.deepEqual(inventoryLocationStatsData(state,'i'),before);
  assert.equal(inventoryStatsData(state,'i').onHand,8);
});

test('history compaction preserves locations even when only a transfer is removed',()=>{
  const state={inventoryEvents:[
    {id:'a',itemId:'i',type:'opening',quantity:8,location:'מחסן גדול'},
    {id:'b',itemId:'i',type:'transfer',quantity:3,fromLocation:'מחסן גדול',toLocation:'מקלט'},
    {id:'c',itemId:'i',type:'reserve',quantity:1,location:'מקלט',pickedAt:'2026-01-01'},
  ]};
  for(const ids of [['b'],['a','b','c']]){
    const before=inventoryLocationStatsData(state,'i'),plan=inventoryHistoryDeletePlan(state,ids);
    const compacted={inventoryEvents:state.inventoryEvents.filter(e=>!ids.includes(e.id))};
    for(const [itemId,locations] of plan.locationEffects)for(const [location,quantity] of locations)compacted.inventoryEvents.push({itemId,type:'adjust',quantity,location,historyCompaction:true});
    assert.deepEqual(inventoryLocationStatsData(compacted,'i'),before);
    assert.deepEqual(inventoryStatsData(compacted,'i'),inventoryStatsData(state,'i'));
  }
});

test('minimum uses projected stock so incoming supply is not ordered twice',()=>{
  const item={minStock:3,targetStock:10};
  assert.equal(inventoryStockStatus(item,{available:2,projected:2,incoming:0}).suggested,8);
  assert.equal(inventoryStockStatus(item,{available:-1,projected:4,incoming:5}).needsOrder,false);
  assert.equal(inventoryStockStatus(item,{available:-1,projected:4,incoming:5}).short,true);
  assert.equal(inventoryStockStatus({}, {available:0,projected:0,incoming:0}).needsOrder,false);
  assert.equal(inventoryStockStatus(item,{available:3,projected:3,incoming:0}).needsOrder,false);
});

test('search includes customers, supplier, reference and SKU without case sensitivity',()=>{
  const item={id:'i',name:'כיסא',sku:'ABC-123'},state={inventoryEvents:[{itemId:'i',customerName:'ישראל',supplier:'Furniture Ltd',reference:'PO-79'}]};
  for(const q of ['ישראל','furniture','po-79','abc-123'])assert.ok(inventorySearchMatch(item,q,state),q);
  assert.equal(inventorySearchMatch(item,'unknown',state),false);
});

test('archival rejects offsetting physical balances in separate warehouses',()=>{
  const state={inventoryEvents:[{itemId:'i',type:'adjust',quantity:-2,location:'מחסן קטן'},{itemId:'i',type:'opening',quantity:2,location:'מקלט'}]};
  assert.equal(inventoryStatsData(state,'i').onHand,0);
  assert.equal(inventoryCanArchiveData(state,'i'),false);
});

test('normalization and restore preserve transfer metadata and operational fields',()=>{
  const {normalizeState,validateRestoreJson}=createStateNormalization({});
  const state=normalizeState({suppliers:[],transactions:[],customerDebts:[],customerOrders:[],serviceCalls:[],checks:[],warehouseOrders:[],inventoryItems:[{id:'i',minStock:3,targetStock:10,sku:'SKU-9'}],inventoryEvents:[
    {id:'a',itemId:'i',type:'opening',quantity:8,location:'מחסן גדול'},
    {id:'b',itemId:'i',type:'transfer',quantity:3,fromLocation:'מחסן גדול',toLocation:'מקלט'},
    {id:'c',itemId:'i',type:'order',quantity:2,supplier:'ספק',expectedAt:'2026-09-20',reference:'PO-1',location:'מקלט'},
  ]});
  const restored=validateRestoreJson(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.inventoryItems,state.inventoryItems);
  assert.deepEqual(restored.inventoryEvents,state.inventoryEvents);
  assert.deepEqual(inventoryLocationStatsData(restored,'i'),inventoryLocationStatsData(state,'i'));
  assert.deepEqual(normalizeState(structuredClone(state)),state,'normalization is idempotent');
});

test('reservation search does not include other customers reserving the same item',()=>{
  const state={inventoryItems:[{id:'i',name:'כיסא',sku:'SKU-9'}],inventoryEvents:[
    {id:'a',itemId:'i',type:'reserve',quantity:1,customerName:'ישראל'},
    {id:'b',itemId:'i',type:'reserve',quantity:1,customerName:'משה'},
  ]};
  const warehouseUi={warehouseSearch:'ישראל'},view=createDomainsWarehouseView({warehouseUi,model:{state}});
  assert.ok(view.renderReservationList().includes('ישראל'));
  assert.ok(!view.renderReservationList().includes('משה'));
  warehouseUi.warehouseSearch='sku-9';
  assert.ok(view.renderReservationList().includes('ישראל'));
  assert.ok(view.renderReservationList().includes('משה'));
});
