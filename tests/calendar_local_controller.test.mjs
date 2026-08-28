import assert from 'node:assert/strict';
import {createDomainsCalendarController} from '../netunim-orders/site/assets/js/domains/calendar/controller.js';

globalThis.location={href:'http://localhost:8080/index.html'};
globalThis.history={state:null,replaceState(){}};
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
globalThis.document={querySelector(){return null}};

const ui={currentView:'calendar'};
const calendarUi={viewMode:'month',focusDate:'2026-08-28',calendars:[],events:[],displayEvents:[],pending:[],eventMap:new Map(),cacheFetchedAt:null};
const calendarSession={
  accessToken:'',tokenExpiresAt:0,connected:false,accountVerified:false,accountId:'',expectedAccountId:'',
  autoConnect:false,authResumePromise:null,syncPromise:null,syncing:false,lastError:'',lastSyncAt:null,pollTimer:null,
};
let preference={known:true,autoConnect:false,accountId:''};
const meta=new Map();
const calendarStorage={
  connectionPreference:()=>preference,
  saveConnectionPreference:value=>{preference={known:true,...value}},
  getMeta:async key=>meta.get(key)||'',
  putMeta:async(key,value)=>meta.set(key,value),
  listOperations:async()=>[],
  getRangeCache:async()=>null,
  putRangeCache:async()=>{},
  clearRangeCache:async()=>{},
  addOperation:async()=>{},
};
let authMode='cloud_required';
let tokenUsable=false;
let beginCount=0;
let restoreCount=0;
const calendarAuth={
  hasUsableToken:()=>tokenUsable,
  configured:()=>true,
  ready:()=>true,
  prepare:async()=>true,
  restore:async()=>{
    restoreCount++;
    if(authMode==='not_connected'){const error=new Error('not connected');error.code='calendar_not_connected';throw error}
    if(authMode==='cloud_required'){const error=new Error('cloud required');error.code='calendar_cloud_auth_required';throw error}
    tokenUsable=true;calendarSession.accessToken='token';calendarSession.tokenExpiresAt=Date.now()+3600000;calendarSession.accountId='owner@example.com';calendarSession.expectedAccountId='owner@example.com';return 'token';
  },
  beginConnect:async()=>{
    beginCount++;
    if(authMode==='cloud_required'){const error=new Error('cloud required');error.code='calendar_cloud_auth_required';throw error}
    return false;
  },
  disconnect:async()=>{tokenUsable=false},
  clearToken:()=>{tokenUsable=false;calendarSession.accessToken='';calendarSession.tokenExpiresAt=0},
  authRequiredError:()=>Object.assign(new Error('auth required'),{code:'calendar_auth_required'}),
};
const calendarApi={
  listCalendars:async()=>[{id:'owner@example.com',primary:true,accessRole:'owner',summary:'Main'}],
  fetchEvents:async()=>[],
};
const calendarJournal={flushPending:async()=>{}};
let cloudLoginCount=0;
const controller=createDomainsCalendarController({
  ui,calendarUi,calendarSession,calendarStorage,calendarAuth,calendarApi,calendarJournal,
  mountViewLayout:()=>{},modal:()=>{},closeModal:()=>{},toast:()=>{},requestCloudLogin:()=>{cloudLoginCount++},
});

await controller.calendarAuthAction();
assert.equal(cloudLoginCount,1,'missing localhost Supabase session must route to cloud login UI');
assert.equal(beginCount,1);

authMode='connected';
await controller.resumeAfterCloudLogin();
assert.equal(restoreCount,1,'after local cloud login the existing server-side Calendar connection must be restored first');
assert.equal(beginCount,1,'restoring an existing connection must not send the user through Google again');
assert.equal(calendarSession.accountVerified,true);
assert.equal(preference.autoConnect,true);

tokenUsable=false;calendarSession.accessToken='';calendarSession.tokenExpiresAt=0;calendarSession.accountVerified=false;
authMode='not_connected';
await controller.resumeAfterCloudLogin();
assert.equal(beginCount,2,'only a missing server-side Calendar connection should start Google authorization');

console.log('CALENDAR LOCAL CONTROLLER TESTS PASSED');
