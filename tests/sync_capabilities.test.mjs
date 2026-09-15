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
import {bindActionEvents,floatingMenuPosition} from '../shared/events.js';
test('capability UI gate prevents action callbacks before mutation',()=>{
 const callbacks={},root={addEventListener:(type,fn)=>callbacks[type]=fn};globalThis.Element=class{};const element=new Element();element.getAttribute=()=> 'save';element.matches=()=>false;let writes=0;bindActionEvents(root,{save:()=>writes++},{canRun:()=>false});callbacks.click({composedPath:()=>[element,root],preventDefault(){},stopPropagation(){}});assert.equal(writes,0);
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
