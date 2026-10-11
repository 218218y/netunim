import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageBrowser as orders} from '../netunim-orders/site/assets/js/storage/browser.js';
import {createStorageBrowser as kupa} from '../netunim-kupa/site/assets/js/storage/browser.js';

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
for(const [app,create] of [['orders',orders],['kupa',kupa]])for(const change of ['owner','epoch','primary'])test(`${app} stale ${change} head cannot replace active cache or conflict/pending flags`,async()=>{
  const pause=deferred(),session={storageV2CloudPending:false,cloudConflictBlocked:false,cloudConflictPending:false};
  let live={owner:'account-A',epoch:'epoch-A',writable:true},held=true;
  const old={base:{...live,revision:12,state:{}},pending:false,control:{conflict:{kind:'old-conflict'}},flight:null};
  const runtime={primaryReady:true,get cloudScope(){return live},cloudState:()=>held?pause.promise:Promise.resolve({base:{...live,revision:3,state:{}},pending:true,control:null,flight:null})};
  const browser=create({storageV2:runtime,session});const late=browser.refreshStorageV2CloudState();
  if(change==='owner')live={...live,owner:'account-B'};else if(change==='epoch')live={...live,epoch:'epoch-B'};
  held=false;await browser.refreshStorageV2CloudState();assert.equal(session.storageV2CloudPending,true);
  if(change==='primary')live={...live,writable:false};
  pause.resolve(old);assert.equal(await late,old,'the old result remains available as old-scope evidence');
  assert.equal(session.storageV2CloudPending,true);assert.equal(session.cloudConflictBlocked,false);assert.equal(session.cloudConflictPending,false);
  assert.equal(browser.storageV2CloudOutboxActive(),change!=='primary');
});
