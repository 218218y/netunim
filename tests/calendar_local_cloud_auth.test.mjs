import assert from 'node:assert/strict';
import {createCloudAuth} from '../netunim-orders/site/assets/js/cloud/auth.js';
import {createUiCloud} from '../netunim-orders/site/assets/js/ui/cloud.js';

const storage=new Map([['orders.supabase.email.v1','local@example.com']]);
globalThis.localStorage={
  getItem:key=>storage.has(key)?storage.get(key):null,
  setItem:(key,value)=>storage.set(key,String(value)),
  removeItem:key=>storage.delete(key),
};

const cloudAuth=createCloudAuth({});
await assert.rejects(cloudAuth.ensureSession(),error=>error?.code==='cloud_auth_required');

let modalArgs=null;
let loginArgs=null;
let closeCount=0;
let resumeCount=0;
let openCloudCount=0;
globalThis.document={
  querySelector(selector){
    if(selector==='#cEmail')return {value:'local@example.com'};
    if(selector==='#cPassword')return {value:'secret'};
    return null;
  },
};

const noop=()=>{};
const uiCloud=createUiCloud({
  model:{},files:{},tab:{primaryTab:true},session:{},checksSession:{},ui:{},
  modal:(...args)=>{modalArgs=args},
  supaConfigured:()=>true,
  toast:noop,
  closeModal:()=>{closeCount++},
  authPassword:async(...args)=>{loginArgs=args;return {access_token:'cloud-token'}},
  localSnapshot:noop,markCloudPending:noop,clearCloudPending:noop,setCloud:noop,
  showSecondaryTabGuard:noop,prepareCloudState:()=>({}),render:noop,writeStateToFolder:noop,
  loadSession:()=>null,readCloud:async()=>null,applyOrderCloudState:noop,refreshKupaReadout:async()=>{},
  syncSharedChecksFromCloud:async()=>{},requestCloudSave:async()=>{},restorePendingAgainstCloud:async()=>false,
  startPolling:noop,saveSession:noop,renderSettings:noop,
  resumeCalendarAfterCloudLogin:async()=>{resumeCount++},
});

uiCloud.loginModal('calendar');
assert.equal(modalArgs?.[0],'התחברות לענן לצורך Google Calendar');
assert.match(modalArgs?.[1]||'',/שרת המקומי/);
assert.match(modalArgs?.[2]||'',/data-click-arg0="calendar"/);

await uiCloud.finishCloudLogin('calendar');
assert.deepEqual(loginArgs,['local@example.com','secret']);
assert.equal(closeCount,1);
assert.equal(resumeCount,1);
assert.equal(openCloudCount,0);

console.log('CALENDAR LOCAL CLOUD AUTH TESTS PASSED');
