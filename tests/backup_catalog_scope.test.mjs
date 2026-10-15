import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackupCatalog as orders} from '../netunim-orders/site/assets/js/ui/backup-catalog.js';
import {createBackupCatalog as kupa} from '../netunim-kupa/site/assets/js/ui/backup-catalog.js';
import {createBackupBrowserResources} from '../shared/backup-browser-resources.js';
import {createBackupFileAuthority} from '../shared/backup-file-authority.js';
import {INITIAL_STATE as orderState} from '../netunim-orders/site/assets/js/state/constants.js';
import {INITIAL_STATE as kupaState} from '../netunim-kupa/site/assets/js/state/constants.js';

function gate(){let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail});return {promise,resolve,reject}}
function fixture(app,{hold=false}={}){
  const held=gate(),model={state:structuredClone(app==='orders'?orderState:kupaState)},ui={pendingCloudBackup:null},events={modals:0,downloads:0,toasts:[],renders:0,restores:0};
  let identity={owner:'A',epoch:1},generation=1;
  const authority=createBackupFileAuthority({owner:()=>identity.owner,generation:()=>generation,account:()=>identity,writable:()=>true}),resources=createBackupBrowserResources({authority});
  const browser={...resources,download:(_blob,_name,scope)=>{scope.assertCurrent();events.downloads++;return true}};
  const point={source:'rolling',id:1,revision:3,savedAt:'2026-10-15T08:00:00Z',state:structuredClone(model.state),checksState:{checks:[]},checksRevision:1,checksSavedAt:'2026-10-15T08:00:00Z'};
  const list=async()=>hold?held.promise:{rolling:[],periodic:[]},read=async()=>hold?held.promise:structuredClone(point);
  const restore=async()=>{events.restores++;generation++;return true};
  const api=(app==='orders'?orders:kupa)({model,ui,session:{connectionMode:'supabase',backendReady:true},browser,
    projection:{normalizeState:structuredClone,prepareState:structuredClone,stateFromPayload:payload=>({state:payload})},
    view:{modal:()=>events.modals++,closeModal:()=>{},toast:value=>events.toasts.push(value),renderSettings:()=>events.renders++},
    cloud:{cloudEnabled:()=>true,listOrdersCloudBackups:list,listKupaCloudBackups:list,readOrdersCloudBackupPoint:read,readKupaCloudBackupPoint:read},
    restore:{restoreNormalizedState:restore,restoreState:restore},
  });
  return {api,browser,ui,events,held,point,replace(){identity={owner:'B',epoch:2};api.invalidate();browser.runtime.invalidate()}};
}
for(const app of ['orders','kupa']){
  for(const action of ['list','more','preview','download'])for(const failure of [false,true])test(`${app} obsolete cloud backup ${action} ${failure?'error':'result'} cannot publish under the replacement account`,async()=>{
    const f=fixture(app,{hold:true});f.ui.cloudBackupRaw={rolling:[],periodic:[]};f.ui.cloudBackupHasMore=true;
    const pending=action==='list'?f.api.refreshCloudBackups():action==='more'?f.api.loadMoreCloudBackups():action==='preview'?f.api.previewCloudBackup('rolling',1):f.api.downloadCloudBackup('rolling',1);
    f.replace();const renders=f.events.renders;
    let drained=false;const drain=f.browser.runtime.drain().then(()=>drained=true);await Promise.resolve();assert.equal(drained,false);
    if(failure)f.held.reject(Error('private former-account details'));else f.held.resolve(action==='list'||action==='more'?{rolling:[{id:'old-account'}],periodic:[]}:f.point);
    await pending;await drain;
    assert.equal(f.ui.pendingCloudBackup,null);assert.equal(f.ui.cloudBackupRaw,null);assert.equal(f.events.modals,0);assert.equal(f.events.downloads,0);assert.deepEqual(f.events.toasts,[]);assert.equal(f.events.renders,renders);
    f.browser.runtime.dispose();
  });
  test(`${app} a cached point cannot authorize another account or a fabricated UI target`,async()=>{
    const f=fixture(app);await f.api.loadCloudBackupPoint('rolling',1);
    f.replace();assert.equal(await f.api.applySelectedCloudBackup(),false);assert.equal(f.events.restores,0);
    f.ui.pendingCloudBackup={targetState:{},restoreState:{},point:f.point};assert.equal(await f.api.applySelectedCloudBackup(),false);assert.equal(f.events.restores,0);f.browser.runtime.dispose();
  });
  test(`${app} valid cloud restore can advance its own generation and drain normally`,async()=>{
    const f=fixture(app);await f.api.loadCloudBackupPoint('rolling',1);assert.equal(await f.api.applySelectedCloudBackup(),true);
    await f.browser.runtime.drain();assert.equal(f.events.restores,1);f.browser.runtime.dispose();
  });
}
