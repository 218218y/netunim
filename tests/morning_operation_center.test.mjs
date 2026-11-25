import test from 'node:test';
import assert from 'node:assert/strict';
import {createMorningOperationCenter} from '../shared/morning-operation-center.js';

const id='00000000-0000-4000-8000-000000000031';
const pending={operation_id:id,stage:'check_registration',document_number:'3972',document_type:320,
  amount:9300,check_amount:9300,check_count:10,attempts:64,error_code:'mfa_required',resolved_at:null};
const reply=(body,status=200)=>Response.json(body,{status});

function pollClock(t){
  t.mock.timers.enable({apis:['setTimeout','Date'],now:100});
  return async ms=>{t.mock.timers.tick(ms);await new Promise(resolve=>setImmediate(resolve))};
}

test('empty, first-read failures and auth failure have distinct cloud evidence',async()=>{
  let mode='fail',now=1;
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},now:()=>now,
    request:async()=>mode==='fail'?reply({},500):mode==='auth'?reply({},401):reply({ok:true,operations:[]})});
  await center.refresh();assert.equal(center.availability,'unavailable');assert.equal(center.cloudStatusLabel,'');
  assert.match(center.markup(String),/לא ניתן לאמת/);
  mode='empty';await center.refresh({force:true});assert.equal(center.availability,'fresh');assert.equal(center.cloudStatusLabel,'');
  mode='fail';now+=46000;await center.refresh();assert.equal(center.availability,'stale');assert.equal(center.cloudStatusLabel,'');
  now+=4000;await center.refresh();assert.ok(center.cloudStatusLabel);assert.equal(center.count,0);
  mode='auth';await center.refresh({force:true});assert.equal(center.availability,'auth');assert.match(center.cloudStatusLabel,/אימות/);
});

test('a failed background job remains visible with an empty operation list and clears on recovery',async()=>{
  const healthy={state:'healthy',pending:0,last_run_at:'2026-11-24T14:59:00Z'};
  let health={bank:{state:'job_unavailable',pending:1,sql_error:'private bank text'},morning:healthy};
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},
    request:async(_path,options)=>{
      const body=JSON.parse(options.body);
      assert.equal(body.background_health,body.filter==='active'&&!body.query?true:undefined);
      return reply({ok:true,operations:[],background_health:health});
    }});
  await center.refresh();
  assert.equal(center.count,0);
  assert.match(center.cloudStatusLabel,/רקע פיננסי דורש בדיקה/);
  assert.match(center.markup(String),/לא התקבל אישור שמשימת הרקע פועלת/);
  assert.doesNotMatch(center.markup(String),/private bank text/);
  await center.search('resolved','');
  assert.match(center.cloudStatusLabel,/דורש בדיקה/);
  health=null;await center.refresh({force:true});
  assert.match(center.cloudStatusLabel,/לא ניתן לאמת את תהליכי הרקע/);
  health={bank:healthy,morning:healthy};await center.refresh({force:true});
  assert.equal(center.cloudStatusLabel,'');
});

test('a 51st operation is reachable and registered checks are not presented as pending bank work',async()=>{
  const first=Array.from({length:50},(_,i)=>({...pending,operation_id:`00000000-0000-4000-8000-${String(100+i).padStart(12,'0')}`}));
  const cursor={priority:0,sort_at:'2026-11-24T15:00:00Z',operation_id:first.at(-1).operation_id};
  const last={...pending,stage:'bank_link',source_kind:'bank',document_number:'LAST-51',checks_registered_at:'2026-11-24T15:00:00Z'};
  const request=async(_path,options)=>{
    const body=JSON.parse(options.body);
    if(body.action==='status')return reply({ok:true,operation:{operation_id:id,state:'created'},bank_link_pending:true});
    if(body.after){assert.deepEqual(body.after,cursor);return reply({ok:true,operations:[last],next:null})}
    return reply({ok:true,operations:first,next:cursor});
  };
  const center=createMorningOperationCenter({request,accountScope:()=>({owner:'owner',epoch:1}),publish(){}});
  await center.refresh();assert.equal(center.count,50);assert.equal(center.more,true);
  await center.action('morning-next','');
  assert.match(center.markup(String),/LAST-51/);assert.match(center.markup(String),/10 נרשמו/);
  assert.doesNotMatch(center.markup(String),/10 ממתינים/);
  await center.action('morning-retry',id);
  assert.match(center.markup(String),/קישור המסמך לתנועת הבנק עדיין ממתין/);
  await center.action('morning-previous','');assert.doesNotMatch(center.markup(String),/LAST-51/);
});

test('a poll refreshes the selected search while preserving its filter and term',async()=>{
  let rows=[pending],requests=[];
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},
    request:async(_path,{body})=>{requests.push(JSON.parse(body));return reply({ok:true,operations:rows})}});
  await center.refresh();await center.search('attention','3972');
  rows=[];await center.refresh({force:true});
  assert.equal(center.count,0);
  assert.doesNotMatch(center.markup(String),/10 ממתינים/);
  assert.match(center.markup(String),/value="attention" selected/);
  assert.match(center.markup(String),/value="3972"/);
  assert.deepEqual(requests.map(row=>[row.filter,row.query]),[['active',''],['attention','3972'],['active',''],['attention','3972']]);
});

test('a second page refresh distinguishes operations off the first page from resolved rows',async()=>{
  const first=Array.from({length:50},(_,i)=>({...pending,operation_id:`00000000-0000-4000-8000-${String(200+i).padStart(12,'0')}`}));
  const cursor={priority:0,sort_at:'2026-11-24T15:00:00Z',operation_id:first.at(-1).operation_id};
  let rows=[pending],hits=0;
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},
    request:async(_path,{body})=>{const data=JSON.parse(body);if(data.after){hits++;assert.deepEqual(data.after,cursor);return reply({ok:true,operations:rows})}
      return reply({ok:true,operations:first,next:cursor})}});
  await center.refresh();await center.action('morning-next','');
  await center.refresh({force:true});assert.match(center.markup(String),/3972/);
  rows=[];await center.refresh({force:true});
  assert.match(center.markup(String),/עמוד 2/);assert.doesNotMatch(center.markup(String),/3972/);
  assert.equal(hits,3);
});

test('a newer search fences a delayed repeat of the previous query',async()=>{
  let release,calls=0;
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},
    request:async(_path,{body})=>{
      const data=JSON.parse(body);
      if(data.query==='old'&&++calls===2)return new Promise(resolve=>{release=resolve});
      return reply({ok:true,operations:[{...pending,document_number:data.query||'head'}]});
    }});
  await center.refresh();await center.search('active','old');
  const refresh=center.refresh({force:true});
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  await center.search('active','new');
  release(reply({ok:true,operations:[{...pending,document_number:'LATE-OLD'}]}));
  await refresh;
  assert.match(center.markup(String),/value="new"/);
  assert.doesNotMatch(center.markup(String),/LATE-OLD/);
});

test('sustained verification, mismatched evidence and unhealthy jobs request acknowledgement',async()=>{
  let now=Date.parse('2026-11-25T12:00:00Z'),scope={owner:'owner',epoch:1};
  const healthy={state:'healthy',pending:0};
  let background={bank:healthy,morning:healthy};
  let rows=[{...pending,stage:'verification',created_at:new Date(now-1000).toISOString()}];
  const center=createMorningOperationCenter({accountScope:()=>scope,publish(){},now:()=>now,
    request:async()=>reply({ok:true,operations:rows,background_health:background})});
  await center.refresh();assert.equal(center.attention,undefined);
  now+=600_000;await center.refresh({force:true});
  assert.equal(center.attention.operationId,id);
  center.acknowledge(center.attention);assert.equal(center.attention,undefined);assert.equal(center.count,1);
  rows=[{...rows[0],stage:'payment_mismatch'}];await center.refresh({force:true});
  assert.equal(center.attention.severity,'critical');
  rows=[];background={bank:{state:'stopped',pending:1},morning:healthy};await center.refresh({force:true});
  assert.equal(center.count,0);assert.match(center.attention.key,/^job:bank/);
  center.acknowledge(center.attention);assert.equal(center.attention,undefined);
  background=null;await center.refresh({force:true});assert.equal(center.attention,undefined);
  await center.refresh({force:true});assert.equal(center.attention.key,'background');
  background={bank:healthy,morning:healthy};await center.refresh({force:true});
  assert.equal(center.attention,undefined);
  rows=[{...pending,stage:'payment_mismatch'}];await center.refresh({force:true});
  center.acknowledge(center.attention);scope={owner:'other',epoch:2};await center.refresh({force:true});
  assert.equal(center.attention.operationId,id);
});

test('the negotiated server severity controls labels and attention, and a long legacy bank link escalates',async()=>{
  const now=Date.parse('2026-11-25T12:00:00Z');
  let negotiated=true,rows=[{...pending,stage:'bank_link',severity:'error',priority:1,verified_at:new Date(now-1000).toISOString()}];
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},now:()=>now,
    request:async(_url,{body})=>{assert.equal(JSON.parse(body).severity_contract,true);return reply({ok:true,operations:rows,
      ...(negotiated?{severity_contract:true}:{})})}});
  await center.refresh();assert.equal(center.attention.operationId,id);
  assert.match(center.markup(String),/דורש טיפול/);
  rows=[{...rows[0],severity:'info',priority:3}];await center.refresh({force:true});
  assert.equal(center.attention,undefined);
  negotiated=false;
  rows=[{...pending,stage:'bank_link',verified_at:new Date(now-31*60_000).toISOString()}];
  await center.refresh({force:true});assert.equal(center.attention.operationId,id);
});

test('recovery distinguishes MFA, permission, conflict and rate limits without displaying raw errors',async()=>{
  const failures=[
    [403,{code:'mfa_required'},/אימות דו־שלבי/],
    [403,{code:'custom_internal_code'},/אין הרשאה/],
    [409,{code:'some_conflict'},/הפעולה השתנתה בענן/],
    [429,{code:'busy'},/הניסיון מוגבל עד/],
    [503,{code:'maintenance'},/אינו זמין זמנית/],
    [422,{code:'invalid_link'},/השירות דחה/],
  ];
  let current;
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},canReconnect:true,
    request:async(_url,{body})=>JSON.parse(body).action==='list_recovery'?reply({ok:true,operations:[pending]})
      :Response.json({ok:false,...current[1],message:'private-server-details'},{status:current[0],headers:{'Retry-After':'30'}})});
  await center.refresh();
  for(current of failures){
    await center.action('morning-retry',id);
    const markup=center.markup(String);
    assert.match(markup,current[2]);assert.doesNotMatch(markup,/private-server-details|custom_internal_code/);
    assert.equal(markup.includes('morning-authenticate'),current[1].code==='mfa_required');
  }
});

test('the active list, selected page and job feed can have different verification times',async()=>{
  const healthy={state:'healthy',pending:0};
  let background={bank:healthy,morning:healthy},failSelected=false,now=Date.parse('2026-11-25T12:00:00Z');
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},now:()=>now,
    request:async(_url,{body})=>{
      const data=JSON.parse(body);
      if(data.query&&failSelected)return reply({},503);
      return reply({ok:true,operations:[pending],...(data.background_health?{background_health:background}:{})});
    }});
  await center.refresh();await center.search('attention','3972');
  failSelected=true;background=null;now+=60_000;await center.refresh({force:true});
  const markup=center.markup(String);
  assert.equal(center.availability,'fresh');
  assert.match(markup,/אימות ענן אחרון/);assert.match(markup,/אימות העמוד המוצג/);
  assert.match(markup,/מוצגים הנתונים מהבדיקה האחרונה/);
  assert.match(markup,/לא ניתן לאמת את תהליכי הרקע/);assert.match(markup,/אימות תהליכי רקע אחרון/);
  assert.match(markup,/10 ממתינים/);
  failSelected=false;background={bank:healthy,morning:healthy};await center.refresh({force:true});
  assert.doesNotMatch(center.markup(String),/מוצגים הנתונים מהבדיקה האחרונה|לא ניתן לאמת את תהליכי הרקע/);
});

test('a failed manual retry disappears once the active cloud list confirms resolution',async()=>{
  let active=[pending];
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},
    request:async(_url,{body})=>JSON.parse(body).action==='list_recovery'?reply({ok:true,operations:active})
      :reply({ok:true,operation:{operation_id:id,state:'created'},check_retry:{state:'failed'}})});
  await center.refresh();await center.action('morning-retry',id);
  assert.match(center.markup(String),/ניסיון ההתאוששות נכשל/);
  active=[{...pending,stage:'registered',resolved_at:'2026-11-25T12:00:00Z'}];
  await center.refresh({force:true});
  assert.equal(center.count,0);assert.doesNotMatch(center.markup(String),/ניסיון ההתאוששות נכשל/);
});

test('known retry failures and cooldown are shown without recording completion',async()=>{
  let state='failed';
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},
    request:async(path,options)=>JSON.parse(options.body).action==='list_recovery'
      ?reply({ok:true,operations:[pending],next:null})
      :reply({ok:true,operation:{operation_id:id,state:'created'},checks_registration_pending:true,
        check_retry:{state,retry_at:'2026-11-24T15:00:00Z'}})});
  await center.refresh();await center.action('morning-retry',id);
  assert.match(center.markup(String),/ניסיון ההתאוששות נכשל/);
  state='cooldown';await center.action('morning-retry',id);
  assert.match(center.markup(String),/הניסיון מוגבל עד/);
  assert.equal(center.count,1);
});

test('two devices share the server outcome while acknowledging independently',async()=>{
  let rows=[pending],calls=[],time=0,offline=false;
  const request=async(path,options)=>{
    assert.equal(path,'/functions/v1/morning-documents');
    const body=JSON.parse(options.body);calls.push(body);
    if(offline)throw new Error('offline');
    if(body.action==='list_recovery')return reply({ok:true,operations:rows});
    assert.deepEqual(body,{action:'status',operation_id:id,reconcile:true,retry_checks:true});
    rows=[{...pending,stage:'registered',resolved_at:'2026-11-24T15:00:00Z',error_code:null}];
    return reply({ok:true,operation:{operation_id:id}});
  };
  const ports={request,accountScope:()=>({owner:'same-owner',epoch:1}),publish(){},now:()=>time};
  const orders=createMorningOperationCenter(ports),kupa=createMorningOperationCenter(ports);
  await Promise.all([orders.refresh(),orders.refresh(),kupa.refresh()]);
  assert.equal(calls.length,2);
  assert.equal(orders.count,1);assert.equal(kupa.count,1);
  assert.match(orders.markup(String),/3972/);
  await orders.action('morning-ack',id);
  assert.equal(orders.count,1);assert.equal(orders.unread,0);assert.equal(kupa.unread,1);
  assert.match(orders.markup(String),/3972/);
  await Promise.all([orders.action('morning-retry',id),orders.action('morning-retry',id)]);
  assert.equal(calls.filter(call=>call.action==='status').length,1);
  assert.equal(orders.count,0);assert.equal(kupa.count,1);
  offline=true;time+=46_000;await kupa.refresh();
  assert.equal(kupa.count,1,'loss of connection does not hide known incidents');
  assert.match(kupa.markup(String),/אינו מעודכן/);
  offline=false;await kupa.refresh({force:true});
  assert.equal(kupa.count,0);assert.equal(kupa.unread,0);
  assert.match(kupa.markup(String),/רישומי צ׳קים שהושלמו לאחרונה/);
});

test('the response from a previous account cannot repopulate the center',async()=>{
  let scope={owner:'first',epoch:1},release;
  const center=createMorningOperationCenter({accountScope:()=>scope,publish(){},request:()=>
    scope.owner==='first'?new Promise(resolve=>{release=resolve}):Promise.resolve(reply({ok:true,operations:[]}))});
  const read=center.refresh();
  await Promise.resolve();
  scope={owner:'second',epoch:2};
  await center.refresh();
  release(reply({ok:true,operations:[pending]}));await read;
  assert.equal(center.count,0);assert.doesNotMatch(center.markup(String),/3972/);
});

test('the automatic check recovers after a transient startup failure without Search',async t=>{
  const advance=pollClock(t);let reads=0;
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},
    request:async()=>++reads===1?reply({},503):reply({ok:true,operations:[]})});
  t.after(()=>center.dispose());
  await center.start();assert.equal(center.availability,'unavailable');assert.equal(center.cloudStatusLabel,'');
  await advance(3999);assert.equal(reads,1);
  await advance(1);assert.equal(reads,2);assert.equal(center.availability,'fresh');assert.equal(center.cloudStatusLabel,'');
  await advance(44999);assert.equal(reads,2);
  await advance(1);assert.equal(reads,3);
});

test('persistent failures appear and clear automatically, with no foreground request burst',async t=>{
  const advance=pollClock(t);let reads=0,visible=true;
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),isVisible:()=>visible,publish(){},
    request:async()=>++reads<=2?reply({},503):reply({ok:true,operations:[]})});
  t.after(()=>center.dispose());
  await center.start();await advance(4000);
  assert.equal(reads,2);assert.match(center.cloudStatusLabel,/לא ניתן לאמת/);
  visible=false;await center.wake();await advance(60_000);assert.equal(reads,2);
  visible=true;await Promise.all([center.wake(),center.wake(),center.search('active','')]);
  assert.equal(reads,3);assert.equal(center.cloudStatusLabel,'');
});

test('an expired response body frees the read, and a late response cannot replace the recovered list',async t=>{
  const advance=pollClock(t);let firstSignal,releaseBody,reads=0;
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),publish(){},
    request:async(_path,{signal})=>{
      if(++reads>1)return reply({ok:true,operations:[]});
      firstSignal=signal;
      return {ok:true,status:200,json:()=>new Promise(resolve=>{releaseBody=resolve})};
    }});
  t.after(()=>center.dispose());
  const first=center.start();await advance(0);assert.equal(typeof releaseBody,'function');
  await advance(12000);assert.equal(await first,false);assert.equal(firstSignal.aborted,true);
  await advance(4000);assert.equal(center.availability,'fresh');assert.equal(reads,2);
  releaseBody({ok:true,operations:[pending]});await advance(0);
  assert.equal(center.count,0);assert.equal(center.cloudStatusLabel,'');
});

test('manual refresh and filters respect a rate limit and reconnect with the same lifecycle',async t=>{
  const advance=pollClock(t);let reads=0,online=true;
  const center=createMorningOperationCenter({accountScope:()=>({owner:'owner',epoch:1}),isOnline:()=>online,publish(){},
    request:async()=>++reads===1?Response.json({}, {status:429,headers:{'Retry-After':'15'}}):reply({ok:true,operations:[]})});
  t.after(()=>center.dispose());
  await center.start();await center.refresh({force:true});await center.search('attention','');
  assert.equal(reads,1);
  await advance(14999);assert.equal(reads,1);
  await advance(1);assert.equal(reads,2);assert.equal(center.availability,'fresh');
  online=false;await center.refresh();await advance(60_000);
  assert.equal(reads,2);assert.equal(center.availability,'offline');
  online=true;await center.wake();assert.equal(reads,3);assert.equal(center.cloudStatusLabel,'');
});
