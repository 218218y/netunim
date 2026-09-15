import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyBulkRangeSelection} from '../netunim-orders/site/assets/js/ui/bulk-selection.js';
import {createStateNormalization} from '../netunim-orders/site/assets/js/state/normalization.js';
import {createDomainsWarehouseView} from '../netunim-orders/site/assets/js/domains/warehouse/view.js';
import {createDomainsInventoryView} from '../netunim-orders/site/assets/js/domains/inventory/view.js';
import {createUiActions} from '../netunim-orders/site/assets/js/ui/actions.js';
import {createContexts} from '../netunim-orders/site/assets/js/state/contexts.js';
import {readFileSync} from 'node:fs';
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
  inventorySuggestedLocation,
  knownWarehouseLocation,
} from '../netunim-orders/site/assets/js/domains/inventory/model.js';


test('warehouse defaults to category grouping and exposes grouping options in requested order',()=>{
  const {warehouseUi}=createContexts();
  assert.equal(warehouseUi.inventoryGrouping,'category');

  const originalDocument=globalThis.document,main={innerHTML:''};
  globalThis.document={querySelector:selector=>selector==='#main'?main:null};
  try{
    const state={inventoryItems:[],inventoryEvents:[],warehouseOrders:[]};
    const view=createDomainsWarehouseView({
      warehouseUi,
      model:{state},
      mountViewLayout:()=>{},
      inventoryTotals:()=>({onHand:0,reserved:0,available:0,incoming:0}),
      inventoryStockViewData:()=>({location:'',filter:'',grouping:warehouseUi.inventoryGrouping,items:[]}),
      renderStockGrid:()=>'',
      renderWarehouseLocations:()=>'',
      warehouseBulkControls:()=>'',
      syncWarehouseBulkUi:()=>{},
      inventoryEventView:event=>event,
    });
    view.renderWarehouse();
    const selectStart=main.innerHTML.indexOf('<select aria-label="קיבוץ מלאי"');
    const selectEnd=main.innerHTML.indexOf('</select>',selectStart);
    const select=main.innerHTML.slice(selectStart,selectEnd);
    const categoryAt=select.indexOf('>לפי קטגוריה</option>');
    const locationAt=select.indexOf('>לפי מחסן</option>');
    const allAt=select.indexOf('>כל הפריטים</option>');
    assert.ok(selectStart>=0&&selectEnd>selectStart);
    assert.ok(categoryAt>=0&&locationAt>categoryAt&&allAt>locationAt);
    assert.match(select,/value="category" selected>לפי קטגוריה<\/option>/);
  }finally{
    if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
  }
});

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

test('warehouse stock grid keeps result scope out of the table body',()=>{
  const state={inventoryItems:[{id:'i1',name:'כיסא',category:'כיסאות',defaultLocation:'מחסן קטן',active:true}],inventoryEvents:[{id:'e1',itemId:'i1',type:'opening',quantity:3,location:'מחסן קטן'}]};
  const warehouseUi={inventoryLocation:'',inventoryFilter:'',inventoryGrouping:'',warehouseSearch:'',warehouseBulkSelected:new Set(),warehouseBulkMode:false};
  const view=createDomainsInventoryView({
    warehouseUi,
    model:{state},
    orderedInventoryCategoryNames:()=>['כיסאות'],
    inventoryStats:id=>inventoryStatsData(state,id),
    inventoryCategoryGroups:()=>[{name:'כיסאות',items:state.inventoryItems}],
  });
  const data=view.inventoryStockViewData(),html=view.renderStockGrid(data);
  assert.equal(data.items.length,1);
  assert.equal(data.location,'');
  assert.ok(html.includes('inventory-table'));
  assert.ok(!html.includes('inventory-result-count'));
  assert.ok(!html.includes('1 פריטים · כל המחסנים'));
});

test('warehouse toolbar keeps tabs, compact metrics and unlabeled selects on one control row',()=>{
  const originalDocument=globalThis.document,main={innerHTML:''},results={innerHTML:''},footer={innerHTML:''};
  globalThis.document={querySelector:selector=>selector==='#main'?main:selector==='#warehouseSearchResults'?results:selector==='#warehouseTotalLine'?footer:null};
  try{
    const warehouseUi={warehouseTab:'stock',warehouseSearch:'',inventoryLocation:'',inventoryFilter:'',inventoryGrouping:'',warehouseBulkMode:false,warehouseBulkSelected:new Set()};
    const state={inventoryItems:[],inventoryEvents:[],warehouseOrders:[]};
    let visibleCount=2;
    const view=createDomainsWarehouseView({
      warehouseUi,
      model:{state},
      mountViewLayout:()=>{},
      inventoryTotals:()=>({onHand:0,reserved:0,available:0,incoming:0}),
      inventoryStockViewData:()=>({location:'',filter:'',grouping:'',items:Array.from({length:visibleCount},(_,i)=>({id:String(i)}))}),
      renderStockGrid:data=>`<div class="stock-table-wrap" data-count="${data.items.length}"></div>`,
      renderWarehouseLocations:()=>'',
      warehouseBulkControls:()=>'',
      syncWarehouseBulkUi:()=>{},
      inventoryEventView:event=>event,
    });
    view.renderWarehouse();
    const html=main.innerHTML,toolbarStart=html.indexOf('warehouse-toolbar-bottom'),resultsStart=html.indexOf('warehouseSearchResults');
    const controls=html.slice(toolbarStart,resultsStart);
    assert.ok(toolbarStart>=0&&resultsStart>toolbarStart);
    assert.ok(controls.indexOf('module-tabs')<controls.indexOf('warehouse-metrics'));
    assert.ok(controls.includes('פריטים בחוסר')&&controls.includes('דורשים הזמנה')&&controls.includes('הזמנות בדרך')&&controls.includes('שמירות ללקוחות'));
    assert.ok(controls.includes('<select aria-label="סינון לפי מחסן"'));
    assert.ok(controls.includes('<select aria-label="קיבוץ מלאי"'));
    assert.ok(!controls.includes('<label>מחסן'));
    assert.ok(!controls.includes('<label>תצוגה'));
    assert.ok(html.includes('warehouse-total-line">2 פריטים · כל המחסנים · סך כל המחסנים'));
    visibleCount=1;
    view.renderWarehouse({resultsOnly:true});
    assert.ok(results.innerHTML.includes('data-count="1"'));
    assert.ok(footer.innerHTML.startsWith('1 פריטים · כל המחסנים · סך כל המחסנים'));
  }finally{
    if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
  }
});

test('active stock-status clear control sits inside the metric group before shortage metrics',()=>{
  const originalDocument=globalThis.document,main={innerHTML:''};
  globalThis.document={querySelector:selector=>selector==='#main'?main:null};
  try{
    const warehouseUi={warehouseTab:'stock',warehouseSearch:'',inventoryLocation:'',inventoryFilter:'short',inventoryGrouping:'',warehouseBulkMode:false,warehouseBulkSelected:new Set()};
    const state={inventoryItems:[],inventoryEvents:[],warehouseOrders:[]};
    const view=createDomainsWarehouseView({
      warehouseUi,model:{state},mountViewLayout:()=>{},inventoryTotals:()=>({onHand:0,reserved:0,available:0,incoming:0}),
      inventoryStockViewData:()=>({location:'',filter:'short',grouping:'',items:[]}),renderStockGrid:()=>'',renderWarehouseLocations:()=>'',warehouseBulkControls:()=>'',syncWarehouseBulkUi:()=>{},inventoryEventView:event=>event,
    });
    view.renderWarehouse();
    const html=main.innerHTML,metricsStart=html.indexOf('<div class=\"warehouse-metrics\"'),filtersStart=html.indexOf('<div class=\"warehouse-filters\"'),metrics=html.slice(metricsStart,filtersStart);
    assert.ok(metricsStart>=0&&filtersStart>metricsStart);
    assert.ok(metrics.includes('נקה סינון מצב ×'));
    assert.ok(metrics.indexOf('נקה סינון מצב ×')<metrics.indexOf('פריטים בחוסר'),'RTL first child keeps the clear control immediately to the right of the shortage metric');
    const filtersEnd=html.indexOf('</div>',filtersStart);
    assert.ok(!html.slice(filtersStart,filtersEnd).includes('נקה סינון מצב ×'),'clear control must not widen the filter group');
  }finally{
    if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
  }
});

test('every stock row exposes order receive reserve and keeps only four secondary actions in the menu',()=>{
  const state={inventoryItems:[{id:'i1',name:'כיסא',category:'כיסאות',defaultLocation:'מחסן קטן',active:true}],inventoryEvents:[]};
  const warehouseUi={warehouseSearch:'',inventoryLocation:'',inventoryFilter:'',inventoryGrouping:'',warehouseBulkSelected:new Set(),warehouseBulkMode:false};
  const view=createDomainsInventoryView({warehouseUi,model:{state},orderedInventoryCategoryNames:()=>['כיסאות'],inventoryStats:id=>inventoryStatsData(state,id),inventoryCategoryGroups:()=>[{name:'כיסאות',items:state.inventoryItems}]});
  for(const withIncoming of [false,true]){
    state.inventoryEvents=withIncoming?[{id:'ord',itemId:'i1',type:'order',quantity:2,location:'מחסן קטן'}]:[];
    const html=view.stockCard(state.inventoryItems[0]),detailsAt=html.indexOf('<details class=\"warehouse-menu\"'),visible=html.slice(html.indexOf('<div class=\"stock-actions\">'),detailsAt),menu=html.slice(detailsAt);
    const orderAt=visible.indexOf('data-action=\"open-inventory-event-modal\"'),receiveAt=visible.indexOf('data-action=\"open-stock-receive\"'),reserveAt=visible.indexOf('data-action=\"open-inventory-event-modal-2\"');
    assert.ok(orderAt>=0&&receiveAt>orderAt&&reserveAt>receiveAt,'visible RTL action order is order, receive, reserve');
    assert.ok(visible.includes('>הזמן</button>')&&visible.includes('>קליטה</button>')&&visible.includes('>שמור</button>'));
    assert.ok(!menu.includes('data-action=\"open-inventory-event-modal\"'));
    assert.ok(!menu.includes('data-action=\"open-stock-receive\"'));
    assert.ok(!menu.includes('data-action=\"open-inventory-event-modal-2\"'));
    for(const label of ['העברה בין מחסנים','ספירת מלאי','עריכת פריט','פרטים ותנועות'])assert.ok(menu.includes(label),label);
    assert.equal((menu.match(/<button class=\"btn small\"/g)||[]).length,4);
  }
});

test('warehouse metrics stay with the left-side filters instead of the primary tabs',()=>{
  const css=readFileSync(new URL('../netunim-orders/site/assets/app.css',import.meta.url),'utf8');
  assert.match(css,/\.warehouse-metrics\{[^}]*margin-inline-start:auto/);
  assert.match(css,/\.warehouse-filters\{[^}]*margin-inline-start:0/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*?\.warehouse-metrics\{[^}]*margin-inline-start:0/);
});

test('clicking Stock again clears a stock status quick-filter without clearing warehouse scope',()=>{
  const warehouseUi={warehouseTab:'stock',inventoryFilter:'short',inventoryLocation:'מחסן גדול',inventoryGrouping:'location',warehouseSearch:''};
  const tabCalls=[];
  let renders=0;
  const actions=createUiActions({
    warehouseUi,
    ui:{checksBulkSelected:new Set()},
    setWarehouseTab:tab=>tabCalls.push(tab),
    renderWarehouse:()=>{renders++},
  });
  actions['set-warehouse-tab']();
  assert.equal(warehouseUi.inventoryFilter,'');
  assert.equal(warehouseUi.inventoryLocation,'מחסן גדול');
  assert.equal(warehouseUi.inventoryGrouping,'location');
  assert.deepEqual(tabCalls,[],'same-tab reset renders directly instead of being swallowed by setWarehouseTab early return');
  assert.equal(renders,1);
});

test('stock quick-filter still applies after Stock-tab reset semantics were added',()=>{
  const warehouseUi={warehouseTab:'stock',inventoryFilter:'',inventoryLocation:'מחסן קטן',inventoryGrouping:'',warehouseSearch:'abc'};
  const tabCalls=[];
  let renders=0;
  const actions=createUiActions({
    warehouseUi,
    ui:{checksBulkSelected:new Set()},
    setWarehouseTab:tab=>tabCalls.push(tab),
    renderWarehouse:()=>{renders++},
  });
  actions['warehouse-quick-filter']({dataset:{clickArg0:'low',clickArg1:'stock'}});
  assert.equal(warehouseUi.inventoryFilter,'low');
  assert.equal(warehouseUi.inventoryLocation,'');
  assert.equal(warehouseUi.warehouseSearch,'');
  assert.deepEqual(tabCalls,['stock']);
  assert.equal(renders,1);
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

test('new form suggestions distinguish catalog preferences from recorded event locations',()=>{
  const item={id:'i',defaultLocation:'לא ידוע'},state={inventoryEvents:[{itemId:'i',type:'opening',quantity:5,location:'מקלט'}]};
  assert.equal(inventorySuggestedLocation(state,item,{type:'reserve'}),'מקלט');
  assert.equal(inventorySuggestedLocation(state,item,{location:'מחסן קטן'}),'מחסן קטן');
  assert.equal(inventorySuggestedLocation(state,item,{event:{location:''}}),'','editing an old event must not silently reassign it');
  item.defaultLocation='מחסן גדול';
  assert.equal(inventorySuggestedLocation(state,item,{type:'order'}),'מחסן גדול');
  assert.equal(inventorySuggestedLocation(state,item,{type:'reserve'}),'מקלט','one available warehouse beats an empty preferred warehouse');
  assert.equal(knownWarehouseLocation('מחסן גדול / מקלט'),'');
  assert.equal(knownWarehouseLocation('לא ידוע'),'');
  assert.equal(knownWarehouseLocation('מחסן   גדול'),'מחסן גדול');
});
