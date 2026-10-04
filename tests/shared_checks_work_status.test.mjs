import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateSnapshots} from '../netunim-orders/site/assets/js/state/snapshots.js';
import {createSyncChecksState} from '../netunim-kupa/site/assets/js/sync/checks-state.js';

test('Orders and Kupa use Shared V2 work status instead of a V1 checks outbox for bank guards',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>'{"stale":"v1"}'}});
  try{
    let pending=false;
    const orders=createStateSnapshots({
      model:{state:{checks:[]}},session:{cloudSaveRequested:false},
      checksSession:{checksSaveRequested:false,checksCloudBase:[]},
      prepareState:value=>structuredClone(value),
      sharedChecksHasLocalWork:()=>pending,
    });
    const kupa=createSyncChecksState({
      model:{state:{checks:[]}},session:{},
      checksSession:{sharedChecksSaveRequested:false,sharedChecksBase:[]},
      sharedChecksHasLocalWork:()=>pending,
    });
    assert.equal(orders.checksHaveLocalWork(),false);
    assert.equal(kupa.sharedChecksHaveLocalWork(),false);
    pending=true;
    assert.equal(orders.checksHaveLocalWork(),true);
    assert.equal(kupa.sharedChecksHaveLocalWork(),true);
  }finally{
    if(original)Object.defineProperty(globalThis,'localStorage',original);
    else delete globalThis.localStorage;
  }
});
