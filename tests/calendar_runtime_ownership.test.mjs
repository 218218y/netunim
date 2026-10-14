import {createCalendarBrowserEffects} from '../netunim-orders/site/assets/js/platform/calendar-browser-effects.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarControllerFixture as createDomainsCalendarController} from './calendar_controller_ports.mjs';
import {createOrdersCalendarRuntime} from '../netunim-orders/site/assets/js/composition/calendar.js';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const changed=()=>Object.assign(new Error('old login'),{code:'CALENDAR_OPERATION_SCOPE_CHANGED'});
function fixture(t){
  const keys=['window','document','navigator','setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame'];
  const prior=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const timers=new Map(),callbacks=[],modals=[],frames=new Map();let id=0,epoch=1,restores=0;
  const install=(key,value)=>Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  install('window',new EventTarget());install('document',Object.assign(new EventTarget(),{visibilityState:'hidden',querySelector:()=>null}));install('navigator',{onLine:true});
  install('setTimeout',run=>{const key=++id;timers.set(key,run);callbacks.push(run);return key});install('clearTimeout',key=>timers.delete(key));
  install('setInterval',()=>++id);install('clearInterval',()=>{});install('requestAnimationFrame',run=>{frames.set(++id,run);return id});install('cancelAnimationFrame',key=>frames.delete(key));
  t.after(()=>{for(const [key,descriptor] of prior)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]});
  const held=gate(),entered=gate(),session={accountId:'A',accountVerified:false,autoConnect:true,syncing:false,lastSyncAt:null},ui={currentView:'dashboard'};
  const inputs={effects:createCalendarBrowserEffects(),ui,tab:{primaryTab:true},calendarSession:session,calendarUi:{focusDate:'2026-10-12',viewMode:'month',calendars:[{id:'A',primary:true,accessRole:'owner'}],events:[],pending:[]},
    subscribeAccountScope:()=>()=>{},toast:()=>{},modal:(...args)=>modals.push(args),
    calendarStorage:{connectionPreference:()=>({known:true,autoConnect:true,accountId:'A'}),saveConnectionPreference:()=>{}},
    calendarAuth:{configured:()=>true,ready:()=>true,prepare:async()=>{},hasUsableToken:()=>false,
      captureOperation:()=>{const captured=epoch;return {owner:'fixture',assertCurrent(){if(captured!==epoch)throw changed()}}},
      restore:async()=>{const captured=epoch;if(++restores===1){entered.resolve();await held.promise;if(captured!==epoch)throw changed()}throw Object.assign(new Error('needs connection'),{code:'calendar_not_connected'})},
      beginConnect:async()=>false},calendarApi:{},calendarJournal:{}};
  return {inputs,held,entered,session,ui,timers,callbacks,modals,changeAccount:()=>{epoch++},restores:()=>restores};
}
for(const command of ['calendarAuthAction','refreshCalendar'])test(`a new login ${command} cannot join the old held remembered restoration`,async t=>{
  const f=fixture(t),controller=createDomainsCalendarController(f.inputs);controller.start();await f.entered.promise;f.changeAccount();
  const action=controller[command]();
  try{for(let i=0;i<35;i++)await Promise.resolve();assert.ok(f.restores()>=2,'new login must not wait for the old network response')}
  finally{f.held.resolve();await action;controller.dispose()}
});
test('a delivered cancelled single-day callback cannot open the superseded editor',async t=>{
  const f=fixture(t);f.ui.currentView='calendar';f.session.accountVerified=true;const controller=createDomainsCalendarController(f.inputs);
  controller.calendarDayCreate('2026-10-13',{detail:1});const old=f.callbacks.at(-1);
  controller.calendarDayCreate('2026-10-14',{detail:1});const current=f.callbacks.at(-1);
  try{old();for(let i=0;i<6;i++)await Promise.resolve();assert.equal(f.modals.length,0,'cancelled callback must not open an old day');current();for(let i=0;i<6;i++)await Promise.resolve();assert.equal(f.modals.length,1)}
  finally{controller.dispose()}
});
test('disposing Calendar before controller composition is final and idempotent',()=>{
  const runtime=createOrdersCalendarRuntime({calendarSession:{},supaFetch:async()=>new Response('{}'),accountScope:()=>({owner:'fixture',epoch:1}),subscribeAccountScope:()=>()=>{}});
  assert.equal(runtime.dispose(),true);assert.equal(runtime.dispose(),false);
  assert.throws(()=>runtime.createController({}),/calendar_runtime_disposed/);
});

test('controller drain retains former-login work after replacement and final disposal',async t=>{
  const f=fixture(t),controller=createDomainsCalendarController(f.inputs);controller.start();await f.entered.promise;f.changeAccount();
  await controller.calendarAuthAction();assert.equal(controller.runtime.isPending(),true);
  assert.equal(controller.dispose(),true);assert.equal(controller.dispose(),false);
  let drained=false;const draining=controller.runtime.drain().then(()=>{drained=true});for(let i=0;i<6;i++)await Promise.resolve();assert.equal(drained,false);
  f.held.resolve();await draining;assert.equal(controller.runtime.isPending(),false);
  assert.equal(await controller.saveCalendarEvent(),false);assert.equal(controller.calendarDayCreate('2026-10-14',{detail:1}),false);
  assert.equal(controller.start(),false);assert.equal(f.timers.size,0);
});

test('a replaced sync revoked before its body starts still releases its busy status',async t=>{
  const f=fixture(t),held=gate(),entered=gate();
  f.inputs.calendarAuth.hasUsableToken=()=>true;
  f.inputs.calendarApi.listCalendars=async()=>{entered.resolve();await held.promise;return []};
  const controller=createDomainsCalendarController(f.inputs),old=controller.syncNow();await entered.promise;
  assert.equal(f.session.syncing,true);f.changeAccount();const replacement=controller.syncNow();f.changeAccount();
  try{assert.equal(await replacement,false);assert.equal(f.session.syncing,false,'revoked preflight must release the current status owner')}
  finally{held.resolve();await old;controller.dispose();await controller.runtime.drain()}
});
