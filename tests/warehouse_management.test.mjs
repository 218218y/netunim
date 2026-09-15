import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyBulkRangeSelection} from '../netunim-orders/site/assets/js/ui/bulk-selection.js';
import {
  WAREHOUSE_LOCATIONS,
  inventoryItemLocationsData,
  inventoryHistoryDeletePlan,
  inventoryStatsData,
} from '../netunim-orders/site/assets/js/domains/inventory/model.js';

test('warehouse fixed locations include unknown in the requested order',()=>{
  assert.deepEqual(WAREHOUSE_LOCATIONS,['מחסן קטן','מחסן גדול','מקלט','לא ידוע']);
  const state={inventoryEvents:[
    {id:'e1',itemId:'legacy',type:'receive',quantity:1,location:'מחסן גדול',createdAt:'2026-01-01'},
    {id:'e2',itemId:'explicit',type:'receive',quantity:1,location:'מקלט',createdAt:'2026-01-01'},
  ]};
  assert.deepEqual(inventoryItemLocationsData(state,{id:'small',defaultLocation:'מחסן   קטן'}),['מחסן קטן']);
  assert.deepEqual(inventoryItemLocationsData(state,{id:'legacy',defaultLocation:'מדף ישן'}),['מחסן גדול']);
  assert.deepEqual(inventoryItemLocationsData(state,{id:'explicit',defaultLocation:'לא ידוע'}),['לא ידוע']);
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
