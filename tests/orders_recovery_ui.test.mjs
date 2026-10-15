import test from 'node:test';
import assert from 'node:assert/strict';
import {syncRecoveryDiffText} from '../netunim-orders/site/assets/js/ui/backup-presentation.js';
import {INITIAL_STATE} from '../netunim-orders/site/assets/js/state/constants.js';

test('Orders recovery review resolves names from the reviewed snapshots and excludes Shared Checks',()=>{
  const remote={...structuredClone(INITIAL_STATE),suppliers:[{id:'S',name:'Synthetic supplier'}],transactions:[{id:'T',supplierId:'S',amount:10}],checks:[{id:'C',amount:5}]};
  const local={...structuredClone(remote),suppliers:[],transactions:[],checks:[]};
  const text=syncRecoveryDiffText(remote,local);
  assert.ok(text.includes('Synthetic supplier'));assert.ok(text.includes('יימחקו'));assert.ok(!text.includes('צ׳קים'));
  assert.deepEqual(remote.suppliers,[{id:'S',name:'Synthetic supplier'}]);assert.equal(local.transactions.length,0);
});
