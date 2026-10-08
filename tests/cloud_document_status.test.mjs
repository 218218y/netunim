import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiStatus as ordersStatus} from '../netunim-orders/site/assets/js/ui/status.js';
import {createUiStatus as kupaStatus} from '../netunim-kupa/site/assets/js/ui/status.js';
import {createSyncChecks as ordersChecks} from '../netunim-orders/site/assets/js/sync/checks.js';
import {createSyncChecks as kupaChecks} from '../netunim-kupa/site/assets/js/sync/checks.js';
import {normalizeSharedChecks} from '../shared/shared-checks-contract.js';
import {createSyncChecksPersistence} from '../netunim-orders/site/assets/js/sync/checks-persistence.js';
import {createStoragePersistence as createKupaPersistence} from '../netunim-kupa/site/assets/js/storage/persistence.js';
import {createStoragePersistence as createOrdersPersistence} from '../netunim-orders/site/assets/js/storage/persistence.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/composition/state-normalization.js';
import {INITIAL_STATE} from '../netunim-kupa/site/assets/js/state/constants.js';

const noop=()=>{},clone=structuredClone;
function gate(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function fixture(app,t){
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',title:'',className:'',classList:{add:noop,remove:noop,contains:cls=>node(id).className.split(' ').includes(cls)},replaceChildren:(_icon,text)=>{node(id).textContent=text.trim()}});return nodes.get(id)};
  for(const [name,value] of Object.entries({navigator:{onLine:true},document:{querySelector:selector=>node(selector.slice(1)),getElementById:node,createElement:()=>({}),createTextNode:text=>text}})){
    const previous=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,value});
    t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name]});
  }
  t.mock.method(globalThis,'setTimeout',()=>0);
  const model={state:{checks:normalizeSharedChecks([{id:'C',amount:25,note:'original'}])}},tab={primaryTab:true};
  const session={localGeneration:0,connectionMode:'supabase',backendReady:true,serverInfo:{},cloudRevision:7,dbRevision:7},checksSession={checksGeneration:0};
  const head={seq:0,base:{revision:8,ackSeq:0,owner:'A',epoch:'E',state:{checks:clone(model.state.checks),bankEvents:[]}},pending:false,flight:null,control:null};
  let account='A',ok=true,extraWork=false;
  const runtime={requested:true,cloudReady:true,get primaryReady(){return tab.primaryTab},get hasLocalWork(){return extraWork||head.pending||!!head.flight||!!head.control},
    lastRemoteUpdatedAt:'2026-10-08T10:00:00Z',sync:async()=>ok,cloudState:async()=>clone(head)};
  const status=(app==='orders'?ordersStatus:kupaStatus)({session,checksSession,tab,storageRecovery:{isReady:()=>true}});
  const ports={sharedChecksV2:runtime,model,session,checksSession,tab,files:{},toast:noop,render:noop,
    setSaveStatus:noop,setCloudHeaderStatus:(mode,text)=>status.setCloudHeaderStatus(mode,text,'shared-checks'),
    refreshCloudHeaderTimestamp:status.refreshCloudHeaderTimestamp,
    setCloud:(...args)=>status.setChecksCloud(...args),
    recomputeKupaNetFromCache:noop,renderKupaDependentView:noop,refreshCloudTimestamp:status.refreshCloudTimestamp,
    loadSession:()=>account?{user:{id:account}}:null,backupSnapshotToComputer:async()=>{},writeStateToFolder:async()=>{},
  };
  const api=(app==='orders'?ordersChecks:kupaChecks)({...ports,
    writeStateToFolder:()=>ports.writeStateToFolder(),backupSnapshotToComputer:()=>ports.backupSnapshotToComputer()});
  const main=(text,mode)=>app==='orders'?status.setCloud(text,mode):status.setCloudHeaderStatus(mode,text);
  const header=()=>node(app==='orders'?'cloudPill':'cloudHeaderStatus');
  return {model,session,checksSession,tab,head,runtime,status,ports,api,main,header,
    ok:value=>{ok=value},extraWork:value=>{extraWork=value},
    edit(){model.state.checks[0].note='later';head.seq++;head.pending=true},
    logout(){account=null;session.backendReady=false;main('ענן: לא פעיל',app==='orders'?'off':'off')},
    account:value=>{account=value},synced:()=>header().className.split(' ').includes('synced'),
  };
}

test('Orders late Finance startup completion cannot overwrite a live Main error',t=>{
  const f=fixture('orders',t);f.status.beginStartupSync({orders:true,checks:true,finance:true});
  f.status.setStartupDomain('orders','ready');f.status.setStartupDomain('checks','ready');
  f.main('ענן: התנגשות','error');f.session.cloudConflictBlocked=true;
  f.status.setStartupDomain('finance','loading');f.status.setStartupDomain('finance','ready');
  assert.equal(f.synced(),false);assert.match(f.header().textContent,/התנגשות/);
});

test('Orders Shared conflict remains visible when Main confirms its own clean head',async t=>{
  const f=fixture('orders',t);f.main('ענן: מסונכרן','synced');f.head.control={conflict:{kind:'check-conflict'}};f.ok(false);
  assert.equal(await f.api.syncSharedChecksFromCloud({quiet:true}),false);
  f.main('ענן: מסונכרן','synced');assert.equal(f.synced(),false);assert.match(f.header().textContent,/צ׳קים|צקים/);
});

for(const app of ['orders','kupa']){
  test(`${app} a local Main append invalidates its cloud success before the scheduled send`,async t=>{
    const f=fixture(app,t);f.session.localGeneration=0;
    f.main('ענן: מסונכרן','synced');assert.equal(await f.api.syncSharedChecksFromCloud({quiet:true}),true);
    assert.equal(f.synced(),true);
    const normalization=createStateNormalization({model:f.model});
    f.model.state=normalization.normalizeState({...clone(INITIAL_STATE),checks:f.model.state.checks,notes:[{id:'N',content:'local'}]});
    const ports={...f.ports,...normalization,setSave:noop,folderSaveTitle:()=>'',domainRevisions:{touch:noop},
      rejectSecondaryMutation:()=>false,localSnapshot:()=>true,persistImmediateBrowserSnapshot:()=>true,
      storageV2Primary:()=>true,cloudEnabled:()=>true,requestCloudSave:async()=>{},
      setCloud:(...args)=>f.status.setCloud(...args),setCloudHeaderStatus:(mode,text)=>f.status.setCloudHeaderStatus(mode,text)};
    const persistence=app==='orders'?createOrdersPersistence(ports):createKupaPersistence(ports);
    const options={domains:['notes'],operations:[{type:'put',collection:'notes',id:'N',mode:'replace',record:clone(f.model.state.notes[0])}]};
    if(app==='orders')persistence.scheduleSave('edit',options);else persistence.saveState('edit',options);
    assert.equal(f.synced(),false,'Main invalidates its own success synchronously');
    assert.equal(f.model.state.notes[0].id,'N');
  });

  for(const offline of [false,true])test(`${app} a local Shared append invalidates the cloud success before its delayed save (offline=${offline})`,async t=>{
    const f=fixture(app,t);f.main('ענן: מסונכרן','synced');assert.equal(await f.api.syncSharedChecksFromCloud({quiet:true}),true);
    assert.equal(f.synced(),true);
    if(offline)navigator.onLine=false;
    f.runtime.persist=()=>{f.head.seq++;f.head.pending=true;return {handled:true,emergencyDurable:true,committed:Promise.resolve()}};
    const ports={...f.ports,setSave:noop,folderSaveTitle:()=>'',refreshAlertCenter:noop,touchChecksRevision:noop,
      rejectSecondaryMutation:()=>false,saveSharedChecksToCloud:async()=>{},showSecondaryTabGuard:noop,
      checksStatus:{save:(text,mode)=>f.status.setSaveStatus(text,mode,'shared-checks'),cloud:(mode,text)=>f.status.setCloudHeaderStatus(mode,text,'shared-checks')}};
    const persistence=app==='orders'?createSyncChecksPersistence(ports):createKupaPersistence(ports);
    f.model.state.checks[0].note='saved-locally';
    const saving=app==='orders'?persistence.scheduleCheckSave('edit',{operations:[]}):persistence.saveChecksState('edit',{operations:[]});
    assert.equal(f.synced(),false,'the pending event is published synchronously at append submission');
    if(offline)assert.ok(f.header().className.split(' ').includes('offline'));
    await saving;assert.equal(f.head.pending,true);assert.equal(f.model.state.checks[0].id,'C');
  });

  test(`${app} a late local Shared commit failure preserves risk without publishing to another account`,async t=>{
    const f=fixture(app,t),commit=gate(),events=[];
    f.runtime.persist=()=>{f.head.seq++;f.head.pending=true;return {handled:true,emergencyDurable:false,committed:commit.promise}};
    const ports={...f.ports,setSave:noop,folderSaveTitle:()=>'',rejectSecondaryMutation:()=>false,saveSharedChecksToCloud:async()=>{},
      setCloud:(...args)=>{events.push(args);f.ports.setCloud(...args)},
      checksStatus:{save:noop,cloud:(...args)=>{events.push(args);f.ports.setCloudHeaderStatus(...args)}}};
    const p=app==='orders'?createSyncChecksPersistence(ports):createKupaPersistence(ports);
    const saving=app==='orders'?p.scheduleCheckSave('edit',{operations:[]}):p.saveChecksState('edit',{operations:[]});
    assert.equal(events.length,1);f.account('B');commit.reject(new Error('injected local commit failure'));
    await saving;await commit.promise.catch(noop);await Promise.resolve();
    assert.equal(events.length,1,'the old account cannot publish its late cloud error');
    assert.equal(f.session.localUndurableGenerations.size,1);assert.equal(f.head.pending,true);
  });

  for(const dirty of ['pending','flight','retry','unacknowledged','runtime-work','view-change'])test(`${app} Shared sync result alone cannot confirm ${dirty} as synced`,async t=>{
    const f=fixture(app,t);f.main('ענן: מסונכרן','synced');
    if(dirty==='pending')f.edit();
    if(dirty==='flight')f.head.flight={operationId:'F'};
    if(dirty==='retry')f.head.control={retry:{lastErrorCode:'network'}};
    if(dirty==='unacknowledged')f.head.seq=1;
    if(dirty==='runtime-work')f.extraWork(true);
    if(dirty==='view-change')f.model.state.checks[0].note='unjournaled';
    assert.equal(await f.api.syncSharedChecksFromCloud({quiet:true}),false);assert.equal(f.synced(),false);
    assert.equal(f.model.state.checks[0].id,'C');assert.equal(f.head.base.ackSeq,0);
  });

  test(`${app} an edit during optional backup prevents a stale Shared success`,async t=>{
    const f=fixture(app,t);f.main('ענן: מסונכרן','synced');
    f.ports.files[app==='orders'?'dirHandle':'backupsDirHandle']={};
    f.ports[app==='orders'?'writeStateToFolder':'backupSnapshotToComputer']=async()=>f.edit();
    assert.equal(await f.api.syncSharedChecksFromCloud({quiet:true}),false);assert.equal(f.synced(),false);
    assert.equal(f.head.pending,true);assert.equal(f.model.state.checks[0].note,'later');
  });

  test(`${app} a held Shared response cannot repaint cloud status after logout`,async t=>{
    const f=fixture(app,t),entered=gate(),release=gate();
    f.runtime.sync=async()=>{entered.resolve();await release.promise;return true};
    const sync=f.api.syncSharedChecksFromCloud({quiet:true});await entered.promise;f.logout();release.resolve();
    assert.equal(await sync,false);assert.equal(f.synced(),false);assert.match(f.header().textContent,/לא פעיל/);
  });

  for(const change of ['leadership','account','offline'])test(`${app} Shared confirmation rejects ${change} changes during its durable read`,async t=>{
    const f=fixture(app,t),entered=gate(),release=gate();f.main('ענן: מסונכרן','synced');
    f.runtime.cloudState=async()=>{const observed=clone(f.head);entered.resolve();await release.promise;return observed};
    const sync=f.api.syncSharedChecksFromCloud({quiet:true});await entered.promise;
    if(change==='leadership')f.tab.primaryTab=false;
    if(change==='account')f.account('B');
    if(change==='offline')navigator.onLine=false;
    release.resolve();assert.equal(await sync,false);assert.equal(f.synced(),false);
    assert.equal(f.head.base.ackSeq,0);assert.equal(f.model.state.checks[0].id,'C');
  });

  test(`${app} an edit during the Shared final durable read rejects its earlier clean snapshot`,async t=>{
    const f=fixture(app,t),entered=gate(),release=gate();f.main('ענן: מסונכרן','synced');
    f.runtime.cloudState=async()=>{const observed=clone(f.head);entered.resolve();await release.promise;return observed};
    const sync=f.api.syncSharedChecksFromCloud({quiet:true});await entered.promise;f.edit();release.resolve();
    assert.equal(await sync,false);assert.equal(f.synced(),false);assert.equal(f.head.pending,true);
    assert.equal(f.model.state.checks[0].note,'later');
  });

  test(`${app} backup receives current Shared metadata before the final receipt check`,async t=>{
    const f=fixture(app,t);f.main('ענן: מסונכרן','synced');f.head.base.state.bankEvents=[{seq:42}];
    f.ports.files[app==='orders'?'dirHandle':'backupsDirHandle']={};
    f.ports[app==='orders'?'writeStateToFolder':'backupSnapshotToComputer']=async()=>{
      assert.equal(f.checksSession[app==='orders'?'checksCloudRevision':'sharedChecksRevision'],8);
      assert.equal(f.checksSession[app==='orders'?'checksBankEvents':'sharedChecksBankEvents'][0].seq,42);
    };
    assert.equal(await f.api.syncSharedChecksFromCloud({quiet:true}),true);assert.equal(f.synced(),true);
  });
}
