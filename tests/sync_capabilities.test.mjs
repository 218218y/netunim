import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncCapabilityGate,MIN_SYNC_CAPABILITIES} from '../shared/sync-capabilities.js';
test('missing or partial capability contract prevents every write and never falls back',async()=>{for(const value of [null,{}, {...MIN_SYNC_CAPABILITIES,financeFencing:0}]){let writes=0;const gate=createSyncCapabilityGate(async()=>value);await assert.rejects(async()=>{await gate.ensure();writes++},/DB/);assert.equal(writes,0)}});
test('compatible handshake coalesces concurrent startup and write checks',async()=>{let calls=0;const gate=createSyncCapabilityGate(async()=>{calls++;return MIN_SYNC_CAPABILITIES});await Promise.all([gate.ensure(),gate.ensure()]);assert.equal(calls,1);assert.equal(gate.ready(),true)});
import {createCloudAuth as ordersAuth} from '../netunim-orders/site/assets/js/cloud/auth.js';
import {createCloudAuth as kupaAuth} from '../netunim-kupa/site/assets/js/cloud/auth.js';
for(const app of ['orders','kupa'])test(`${app} real transport blocks write before HTTP when DB capabilities are absent`,async()=>{
 const session={supaSession:{access_token:'fixture',expires_at:9999999999}};
 globalThis.localStorage={getItem:()=>JSON.stringify(session.supaSession)};
 let writes=0,reads=0;globalThis.fetch=async url=>{if(url.endsWith('/get_netunim_sync_capabilities')){reads++;return new Response('{}',{status:200})}writes++;return new Response('{}',{status:200})};
 const api=app==='orders'?ordersAuth({}):kupaAuth({session});
 await assert.rejects((app==='orders'?api.supaFetch:api.supaRest)('/rest/v1/rpc/save_kupa_document_v5',{method:'POST',body:'{}'}),/DB/);
 assert.equal(reads,1);assert.equal(writes,0);
});
import {bindActionEvents,floatingMenuPosition,floatingMenuWidth} from '../shared/events.js';
import {createUiActions,wrapMutationActions} from '../netunim-orders/site/assets/js/ui/actions.js';
import {createUiStatus} from '../netunim-orders/site/assets/js/ui/status.js';
test('delegated action gate prevents callbacks when a caller rejects an action',()=>{
 const callbacks={},root={addEventListener:(type,fn)=>callbacks[type]=fn};globalThis.Element=class{};const element=new Element();element.getAttribute=()=> 'save';element.matches=()=>false;let writes=0;bindActionEvents(root,{save:()=>writes++},{canRun:()=>false});callbacks.click({composedPath:()=>[element,root],preventDefault(){},stopPropagation(){}});assert.equal(writes,0);
});

test('orders token refresh can reopen a capability check during normal runtime',async t=>{
 const oldStorage=globalThis.localStorage,oldFetch=globalThis.fetch;t.after(()=>{globalThis.localStorage=oldStorage;globalThis.fetch=oldFetch});
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};globalThis.localStorage=storage;
 storage.setItem('orders.supabase.session.v1',JSON.stringify({access_token:'before',refresh_token:'refresh-before',expires_at:9999999999}));
 const session={};let capabilityCalls=0,releaseCapability;
 globalThis.fetch=async url=>{url=String(url);if(url.includes('/auth/v1/token?grant_type=refresh_token'))return new Response(JSON.stringify({access_token:'after',refresh_token:'refresh-after',expires_in:3600}),{status:200});if(url.endsWith('/rest/v1/rpc/get_netunim_sync_capabilities')){capabilityCalls++;if(capabilityCalls===1)return new Response(JSON.stringify(MIN_SYNC_CAPABILITIES),{status:200});await new Promise(resolve=>{releaseCapability=resolve});return new Response(JSON.stringify(MIN_SYNC_CAPABILITIES),{status:200})}return new Response('{}',{status:200})};
 const api=ordersAuth({session});await api.ensureSyncCapabilities();await api.refreshSession({force:true});
 const write=api.supaFetch('/rest/v1/rpc/save_order_management_document_v5',{method:'POST',body:'{}'});await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(session.syncCapabilitiesChecking,true);assert.equal(capabilityCalls,2);releaseCapability();await write;assert.equal(session.syncCapabilitiesChecking,false);
});

test('orders capability checking blocks mutations but never supplier navigation',t=>{
 const oldDocument=globalThis.document,oldSetTimeout=globalThis.setTimeout;t.after(()=>{globalThis.document=oldDocument;globalThis.setTimeout=oldSetTimeout});
 const fakeToast={textContent:'',classList:{add(){},remove(){}}};globalThis.document={querySelector:()=>fakeToast};globalThis.setTimeout=()=>0;
 const classified=createUiActions({supplierMenu:{chooseSupplier(){},toggleSupplierMenu(){},filterSupplierMenu(){},supplierMenuSearchKeydown(){}},supplierUi:{},customerUi:{},serviceUi:{},warehouseUi:{},ui:{}});
 assert.equal(classified['choose-supplier'].startupMutationDomain,undefined);assert.equal(classified['open-supplier'].startupMutationDomain,undefined);assert.equal(classified['save-supplier'].startupMutationDomain,'orders');
 const session={syncCapabilitiesChecking:true,startupSync:{active:false,domains:{orders:{required:false,state:'idle',error:''},checks:{required:false,state:'idle',error:''},finance:{required:false,state:'idle',error:''}}}},checksSession={};
 const status=createUiStatus({session,checksSession});let supplierSelections=0,writes=0;
 const chooseSupplier=()=>supplierSelections++,save=()=>writes++;Object.defineProperty(save,'startupMutationDomain',{value:'orders'});
 const actions=wrapMutationActions({'choose-supplier':chooseSupplier,save},domain=>status.guardStartupMutation(domain));
 actions['choose-supplier']();actions.save();assert.equal(supplierSelections,1);assert.equal(writes,0);assert.equal(actions.save.startupMutationDomain,'orders');
 session.syncCapabilitiesChecking=false;actions.save();assert.equal(writes,1);
 session.syncCapabilitiesError=new Error('DB mismatch');actions['choose-supplier']();actions.save();assert.equal(supplierSelections,2);assert.equal(writes,1);
});

test('floating menu width preserves authored CSS after zero-geometry details dismissal',()=>{
 assert.equal(floatingMenuWidth(0,'756px',0),756);
 assert.equal(floatingMenuWidth(420,'756px',0),420);
 assert.equal(floatingMenuWidth(0,'auto',214),214);
 assert.equal(floatingMenuWidth(0,'auto',0),180);
});

test('floating menus flip and clamp to the visible viewport in both directions',()=>{
 const anchor={left:360,right:392,top:680,bottom:712},size={width:190,height:300},viewport={left:0,top:0,width:400,height:740};
 const p=floatingMenuPosition(anchor,size,viewport,{rtl:true});
 assert.equal(p.up,true);assert.equal(p.top,374);assert.equal(p.left,202);assert.equal(p.width,190);
 const small=floatingMenuPosition({left:5,right:37,top:30,bottom:62},{width:600,height:1000},{left:0,top:0,width:320,height:260});
 assert.equal(small.left,8);assert.equal(small.width,304);assert.equal(small.maxHeight,184);
 const offset=floatingMenuPosition(anchor,size,{left:10,top:100,width:380,height:300},{rtl:true});
 assert.ok(offset.left>=18);assert.ok(offset.top>=108);
});
