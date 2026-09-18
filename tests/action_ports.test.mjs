import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceActionPorts} from '../netunim-orders/site/assets/js/domains/service/action-ports.js';
import {createWarehouseActionPorts} from '../netunim-orders/site/assets/js/domains/warehouse/action-ports.js';

function makePort(group,calls){
  return new Proxy({}, {get:(_target,key)=>(...args)=>{calls.push([group,String(key),args]);return `${group}:${String(key)}`}});
}

function assertDelegates(factory,groups){
  const calls=[],deps={},expected=[];
  for(const [group,names] of Object.entries(groups)){deps[group]=makePort(group,calls);for(const name of names)expected.push(name)}
  const ports=factory(deps);
  assert.deepEqual(Object.keys(ports).sort(),expected.sort());
  for(const [group,names] of Object.entries(groups))for(const name of names){
    calls.length=0;const marker={name};const result=ports[name]('a',marker,3);
    assert.equal(result,`${group}:${name}`);
    assert.deepEqual(calls,[[group,name,['a',marker,3]]]);
  }
}

test('Orders service action ports preserve the domain composition boundary',()=>{
  assertDelegates(createServiceActionPorts,{
    bulk:['toggleServiceBulkMode','toggleServiceBulkRow','toggleServiceBulkVisible','deleteSelectedServiceCalls'],
    view:['renderService','openServiceGmail','toggleServiceFlag'],
    editor:['openServiceModal','saveService','deleteService'],
  });
});

test('Orders warehouse action ports delegate every UI capability without changing arguments',()=>{
  assertDelegates(createWarehouseActionPorts,{
    inventoryOrder:['openInventoryCategoryOrderModal','moveInventoryCategoryOrder','inventoryCategoryOrderDragStart','inventoryCategoryOrderDrop','saveInventoryCategoryOrder'],
    inventorySelectors:['toggleInventoryGroup'],
    bulk:['setWarehouseTab','toggleWarehouseBulkMode','toggleWarehouseBulkRow','toggleWarehouseBulkVisible','archiveSelectedInventoryItems','deleteSelectedWarehouseOrders','deleteSelectedInventoryEvents'],
    view:['toggleWarehousePickedOrders','renderWarehouse'],
    inventoryEditor:['openInventoryItemModal','saveInventoryItem','archiveInventoryItem','openStockAdjustmentModal','previewInventoryLocation','previewStockAdjustment','openStockTransfer','saveStockTransfer','previewStockTransfer','openInventoryDetails','saveStockAdjustment','openInventoryEventModal','saveInventoryEvent','editInventoryEvent','openStockReceive','receiveIncoming','confirmReceive','pickupReservation','releaseReservation','cancelIncoming'],
    editor:['openWarehouseOrderModal','saveWarehouseOrder','setWarehouseOrderStatus','deleteWarehouseOrder'],
  });
});
