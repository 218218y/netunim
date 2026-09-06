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
import {bindActionEvents} from '../shared/events.js';
test('capability UI gate prevents action callbacks before mutation',()=>{
 const callbacks={},root={addEventListener:(type,fn)=>callbacks[type]=fn};globalThis.Element=class{};const element=new Element();element.getAttribute=()=> 'save';element.matches=()=>false;let writes=0;bindActionEvents(root,{save:()=>writes++},{canRun:()=>false});callbacks.click({composedPath:()=>[element,root],preventDefault(){},stopPropagation(){}});assert.equal(writes,0);
});
