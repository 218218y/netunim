import {withKupaStartup,withOrdersStartup} from './startup_ports.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createStartupTask} from '../shared/startup-task.js';
import {createLifecycle as createKupaLifecycle} from '../netunim-kupa/site/assets/js/lifecycle.js';
import {createLifecycle as createOrdersLifecycle} from '../netunim-orders/site/assets/js/lifecycle.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/composition/state-normalization.js';
import {INITIAL_STATE} from '../netunim-kupa/site/assets/js/state/constants.js';
import {assertKupaEntityInvariants,assertValidCloudState} from '../netunim-kupa/site/assets/js/state/validation.js';

test('startup joins concurrent callers and retains its completed result',async()=>{
  let runs=0,complete;
  const gate=new Promise(resolve=>{complete=resolve});
  const start=createStartupTask(async()=>{runs++;await gate;return 'ready'});
  const first=start();
  assert.equal(start(),first);
  await Promise.resolve();
  assert.equal(runs,1);
  complete();
  assert.equal(await first,'ready');
  assert.equal(start(),first);
  assert.equal(await start(),'ready');
  assert.equal(runs,1);
});

test('startup retains synchronous and asynchronous failures without acquiring resources again',async()=>{
  for(const asynchronous of [false,true]){
    let runs=0;
    const error=new Error('recovery_failed');
    const start=createStartupTask(()=>{runs++;if(asynchronous)return Promise.reject(error);throw error});
    const first=start();
    await assert.rejects(first,actual=>actual===error);
    assert.equal(start(),first);
    await assert.rejects(start(),actual=>actual===error);
    assert.equal(runs,1);
  }
  assert.throws(()=>createStartupTask(null),/startup_task_required/);
});

for(const [app,createLifecycle] of [['Kupa',createKupaLifecycle],['Orders',createOrdersLifecycle]]){
  test(`${app} boot cannot repeat a blocked preflight or bypass the write gate`,async()=>{
    const events=[],session={};
    const lifecycle=createLifecycle((app==='Orders'?withOrdersStartup:withKupaStartup)({session,tab:{primaryTab:true},
      acquirePrimaryTabLock:async()=>events.push('lock'),
      hydrateStorageOwner:async()=>events.push('owner'),
      storageOwnerCurrent:()=> 'account-A',authenticatedOwner:()=> 'account-B',
      restoreSupaSession:async()=>null,loadSession:()=>null,
      setConnectUI:()=>events.push('blocked'),setCloud:()=>events.push('blocked'),
      syncFolderAccessButton:()=>{},render:()=>assert.fail('unverified render'),
      ensureLocalBirth:()=>assert.fail('unverified write')}));
    const first=lifecycle.boot();
    assert.equal(lifecycle.boot(),first);
    await first;
    assert.equal(lifecycle.boot(),first);
    assert.deepEqual(events,['lock','owner','blocked']);
    assert.equal(session.storageProtocolBlocked,true);
  });

  test(`${app} boot cannot retry a failed lock in a partially constructed runtime`,async()=>{
    let locks=0;
    const session={},lifecycle=createLifecycle((app==='Orders'?withOrdersStartup:withKupaStartup)({session,
      acquirePrimaryTabLock:()=>{locks++;throw new Error('lock_failed')},
      hydrateStorageOwner:()=>assert.fail('owner must follow lock')}));
    await assert.rejects(lifecycle.boot(),/lock_failed/);
    await assert.rejects(lifecycle.boot(),/lock_failed/);
    assert.equal(locks,1);
    assert.equal(session.storageProtocolBlocked,true);
  });
}

test('Kupa initial data normalizes to valid local and cloud contracts without changing the seed',()=>{
  const before=structuredClone(INITIAL_STATE);
  const normalization=createStateNormalization({model:{lastNormalizeRemovedCredits:0}});
  const local=normalization.normalizeState(INITIAL_STATE);
  assertKupaEntityInvariants(local,{includeChecks:true,required:true});
  assertValidCloudState(normalization.prepareKupaCloudState(local));
  assert.deepEqual(INITIAL_STATE,before);
});
