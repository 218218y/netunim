import test from 'node:test';
import assert from 'node:assert/strict';
import {postAckFixture} from './post_ack_fixture.mjs';
import {createSyncDocument as orders} from '../netunim-orders/site/assets/js/sync/document.js';
import {createSyncDocument as kupa} from '../netunim-kupa/site/assets/js/sync/document.js';

for(const app of ['orders','kupa']){
  test(`${app} actual Main composition binds owners and drains post-ACK edits with independent Checks`,async()=>{
    const f=await postAckFixture(app,{composed:true,remoteChange:true,onCommitted:f=>{f.model.state.checks=[{id:'independent-check',amount:73}];return f.edit('late-note','LOCAL_AFTER_ACK')}});
    assert.equal(await f.save(),true);
    const durable=await f.runtime.recoverReadOnly(),head=await f.runtime.cloudState();
    assert.deepEqual(durable.state.notes,f.model.state.notes);
    assert.equal(head.pending,false);assert.equal(head.flight,null);assert.equal(head.control,null);assert.equal(head.base.ackSeq,2);
    assert.deepEqual(f.model.state.checks,[{id:'independent-check',amount:73}]);
    assert.equal(f.calls.length,2);assert.notEqual(f.calls[0].operationId,f.calls[1].operationId);
    assert.ok(f.calls.every(call=>!Object.hasOwn(call.snapshot,'checks')));
    await f.api.quiesceForStorageCutover();assert.equal(f.api.runtime.isPending(),false);
  });
  test(`${app} actual Main composition fences a replacement login while recovery is accepted`,async()=>{
    const f=await postAckFixture(app,{composed:true,onCommitted:f=>f.edit('late-note','RETAINED'),onRecovery:f=>f.changeLogin()});
    assert.equal(await f.save(),false);
    assert.equal(f.calls.length,1);assert.equal((await f.runtime.cloudState()).control,null);
    assert.equal(f.model.state.notes.find(note=>note.id==='late-note').content,'RETAINED');
    assert.ok(!f.statuses.some(args=>args.includes('synced')));
    await f.api.quiesceForStorageCutover();assert.equal(f.api.runtime.isPending(),false);
  });
  test(`${app} deployed Main factory retires the ungrouped internal API`,()=>{
    assert.throws(()=> (app==='orders'?orders:kupa)({model:{state:{}},session:{},tab:{primaryTab:true}}),TypeError);
  });
}
