"""Production Calendar composition: delayed OAuth/close cannot publish or redirect."""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
  await appReady;finance.runtime.stop();syncDocument.stopPolling();calendarRuntime.dispose();
  const kind=__KIND__,done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
  const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
  const held=gate(),entered=gate(),toasts=[],calendarId='closed-calendar@example.test';
  const {createOrdersCalendarRuntime}=await import('./assets/js/composition/calendar.js');
  const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
  const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');
  const db=createStorageJournalDb(),raw=async()=>JSON.stringify({main:await db.load('local:orders'),checks:await db.load('local:shared-checks')}),before=await raw();
  const session={accessToken:'',tokenExpiresAt:0,connected:false,accountVerified:false,accountId:'',expectedAccountId:'',autoConnect:false,syncing:false,lastError:'',queueObservationError:'',lastSyncAt:null};
  const fetch=globalThis.fetch;
  globalThis.fetch=async url=>new Response(JSON.stringify({items:new URL(url).pathname.endsWith('/calendarList')?[{id:calendarId,primary:true,accessRole:'owner'}]:[]}));
  const runtime=createOrdersCalendarRuntime({calendarSession:session,accountScope:()=>({owner:'disposal-fixture',epoch:1}),subscribeAccountScope:()=>()=>{},supaFetch:async(_path,options)=>{
    const {action}=JSON.parse(options.body);options.assertRequestScope();
    if(action==='token')return kind==='disconnect'
      ?new Response(JSON.stringify({access_token:'fixture-token',expires_in:3600,account_id:calendarId}))
      :new Response(JSON.stringify({code:'calendar_not_connected'}),{status:409});
    check(action===kind,'only the accepted backend action is sent');entered.resolve();await held.promise;
    return new Response(JSON.stringify(kind==='start'?{authorize_url:'https://accounts.google.com/o/oauth2/v2/auth?state=closed-fixture'}:{ok:true}));
  }});
  const controller=runtime.createController({ui:{currentView:'dashboard'},tab:{primaryTab:true},calendarUi:{viewMode:'month',focusDate:'2026-10-14',calendars:[],events:[],displayEvents:[],pending:[]},
    uiLayout:{},uiModal:{modal(){},closeModal(){},confirmDialog:async()=>true},uiStatus:{toast:value=>toasts.push(value)},uiCloud:{loginModal(){throw Error('unexpected cloud login')}},uiDateEditor:{}});
  try{
    if(kind==='disconnect')check(await controller.resumeAfterCloudLogin()===true,'native account cache is verified before disconnect');
    const preference=JSON.stringify(createCalendarStorage().connectionPreference()),queue=JSON.stringify(await createCalendarStorage().listOperations());
    toasts.length=0;
    const pending=controller.calendarAuthAction();await entered.promise;
    check(runtime.dispose()&&!runtime.dispose(),'runtime disposal is final and idempotent');
    let drained=false;const draining=runtime.drain().then(()=>{drained=true});for(let n=0;n<8;n++)await Promise.resolve();
    check(!drained&&controller.runtime.isPending(),'accepted backend work remains owned after close');
    held.resolve();check(await pending===false,'delayed auth result cannot claim completion');await draining;
    check(!controller.runtime.isPending(),'drain joins the delayed backend completion');
    check(location.pathname.endsWith('index.html'),'closed auth cannot navigate from the native application');
    check(JSON.stringify(createCalendarStorage().connectionPreference())===preference,'delayed close cannot change persisted connection intent');
    check(toasts.length===0,'closed auth cannot publish a success or stale warning');
    check(JSON.stringify(await createCalendarStorage().listOperations())===queue,'native durable event queue remains exact');
    check(await raw()===before,'native Main and Shared journals remain exact');
    check(await controller.calendarAuthAction()===false,'closed capability rejects another auth action');
  }finally{held.resolve();runtime.dispose();globalThis.fetch=fetch}
  return done;
})()"""

for kind in ('start','disconnect'):
    with BrowserSession(ROOT/'netunim-orders/site',f'calendar-auth-disposal-{kind}') as browser:
        result=browser.evaluate(FLOW.replace('__KIND__',json.dumps(kind)),timeout=30)
        assert not browser.drain_serious_errors()
        print(f'PASS Calendar delayed {kind}: {len(result)} native lifecycle and retained-journal assertions')
