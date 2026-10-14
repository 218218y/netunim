import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarAuth} from '../netunim-orders/site/assets/js/calendar/auth.js';
import {createCalendarBrowserEffects} from '../netunim-orders/site/assets/js/platform/calendar-browser-effects.js';
import {createCalendarControllerFixture as createDomainsCalendarController} from './calendar_controller_ports.mjs';

function gate(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
function fixture(t,kind){
  const prior=new Map(['location','history','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const redirects=[],preferences=[],toasts=[],held=gate(),entered=gate();
  for(const [key,value] of Object.entries({location:{href:'https://example.test/index.html',assign:url=>redirects.push(url)},history:{state:null,replaceState(){}},document:{querySelector:()=>null}}))Object.defineProperty(globalThis,key,{value,configurable:true});
  t.after(()=>{for(const [key,value] of prior)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]});
  const session={accessToken:'',tokenExpiresAt:0,connected:false,accountVerified:false,accountId:'A',expectedAccountId:'',syncing:false,lastError:''};
  const auth=createCalendarAuth({calendarSession:session,accountScope:()=>({owner:'cloud-A',epoch:1}),supaFetch:async(_path,options)=>{
    const {action}=JSON.parse(options.body);
    if(action==='token')return new Response(JSON.stringify({code:'calendar_not_connected'}),{status:409});
    assert.equal(action,kind);entered.resolve();await held.promise;
    return new Response(JSON.stringify(action==='start'?{authorize_url:'https://accounts.google.com/o/oauth2/v2/auth?state=held'}:{ok:true}));
  }});
  auth.hasUsableToken();
  if(kind==='disconnect'){session.accessToken='accepted-token';session.tokenExpiresAt=Date.now()+3_600_000;session.accountVerified=true;session.connected=true}
  const controller=createDomainsCalendarController({ui:{currentView:'dashboard'},tab:{primaryTab:true},calendarUi:{},calendarSession:session,
    calendarAuth:auth,calendarApi:{},calendarJournal:{},effects:createCalendarBrowserEffects(),subscribeAccountScope:()=>()=>{},
    calendarStorage:{connectionPreference:()=>({known:true,autoConnect:true,accountId:'A'}),saveConnectionPreference:value=>preferences.push(value)},toast:value=>toasts.push(value)});
  t.after(()=>controller.dispose());
  return {controller,session,redirects,preferences,toasts,held,entered};
}

for(const kind of ['start','disconnect'])test(`disposal during native auth ${kind} cannot publish from the closed Calendar`,async t=>{
  const f=fixture(t,kind),action=f.controller.calendarAuthAction();await f.entered.promise;
  f.controller.dispose();let drained=false;
  const draining=f.controller.runtime.drain().then(()=>{drained=true});
  for(let n=0;n<8;n++)await Promise.resolve();assert.equal(drained,false,'accepted backend work must remain owned');
  f.held.resolve();await action;await draining;
  assert.deepEqual(f.redirects,[],'closed Calendar must not navigate to a delayed Google authorization');
  assert.deepEqual(f.preferences,[],'closed Calendar must not publish a delayed disconnect preference');
  assert.deepEqual(f.toasts,[],'closed Calendar must not report a delayed authorization result');
  assert.equal(f.controller.runtime.isPending(),false);
});
