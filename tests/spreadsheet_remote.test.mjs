import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpreadsheetRemote} from '../shared/spreadsheet-remote.js';
import {assertSpreadsheet} from '../shared/spreadsheet-model.js';
import {equalSyncJson} from '../shared/sync-json.js';
import {createDefaultNotesSheet} from '../shared/notes-sheet-model.js';
import {createSpreadsheetSync as createKupa} from '../netunim-kupa/site/assets/js/shared/spreadsheet-sync.js';
import {createSpreadsheetSync as createOrders} from '../netunim-orders/site/assets/js/shared/spreadsheet-sync.js';

function book(value='base'){
  const state=createDefaultNotesSheet();state.rows=[{id:'row',sheetId:state.sheets[0].id,cells:{[state.columns[0].id]:value},createdAt:'',updatedAt:''}];return state;
}
function gate(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function fixture(response,create=createSpreadsheetRemote){
  let changed=false;const requests=[];
  const api=create({domain:'orders',request:async(path,options)=>{requests.push({path,options});return response},
    access:{capture:()=>()=>{if(changed)throw Object.assign(new Error('scope changed'),{code:'fixture_scope_changed'})}},decodeState:assertSpreadsheet,equalState:equalSyncJson});
  return {api,requests,invalidate:()=>{changed=true}};
}
const response=value=>new Response(JSON.stringify(value));
const flight=(state=book('sent'),expected=4)=>({state,payload:{p_domain:'orders',p_document_name:'main',p_expected_revision:expected,p_operation_id:'stable-operation',p_state:state,p_delete_intents:{},p_kind:'edit'}});

test('read boundary accepts only one validated document, or the REST empty array',async()=>{
  for(const value of [null,true,{},[{},{}],{revision:0,state:book()},{revision:4.2,state:book()},
    {revision:Number.MAX_SAFE_INTEGER+1,state:book()},{revision:true,state:book()},
    {revision:'4e0',state:book()},{revision:' 4 ',state:book()},{revision:4,state:{}},
    {revision:4,state:book(),updated_at:'not-a-date'}]){
    await assert.rejects(fixture(response(value)).api.readDocument(),Error,JSON.stringify(value));
  }
  for(const body of ['', '{bad'])await assert.rejects(fixture(new Response(body)).api.readDocument(),{code:'SPREADSHEET_RESPONSE_INVALID'});
  assert.equal(await fixture(response([])).api.readDocument(),null);
  assert.equal(await fixture(response([])).api.readRevision(),null);
  assert.equal((await fixture(response([{revision:'4',state:book(),updated_at:'2026-10-15T12:00:00Z'}])).api.readDocument()).revision,4);
  assert.deepEqual(await fixture(response([{revision:5}])).api.readRevision(),{revision:5});
});

test('ACK boundary rejects malformed/ambiguous envelopes, false revisions and unproved states',async()=>{
  const valid={revision:5,state:book('sent'),operation_replayed:false};
  const values=[null,[],[valid,valid],{...valid,revision:undefined},{...valid,revision:4},
    {...valid,revision:6},{...valid,revision:0},{...valid,revision:true},{...valid,state:book('other')},
    {...valid,state:{}},{...valid,operation_replayed:undefined},{...valid,operation_replayed:'false'},
    {...valid,operation_replayed:0},{...valid,revision:3,operation_replayed:true},
    {...valid,revision:4,operation_replayed:true},{...valid,state:book('other'),operation_replayed:true}];
  for(const value of values)await assert.rejects(fixture(response(value)).api.write(flight(),book()),Error,JSON.stringify(value));
});

test('fresh saves/no-ops, restore no-ops and lost-ACK later-head replay follow the actual SQL policy',async()=>{
  const base=book(),sent=book('sent');
  const result=await fixture(response([{revision:5,state:sent,operation_replayed:false}])).api.write(flight(sent),base);
  assert.equal(result.revision,5);assert.equal(result.operation_replayed,false);
  assert.equal((await fixture(response([{revision:4,state:base,operation_replayed:false}])).api.write(flight(base),base)).revision,4);
  assert.equal((await fixture(response([{revision:1,state:base,operation_replayed:false}])).api.write(flight(base,0),base)).revision,1);
  const later=book('another computer');
  assert.deepEqual((await fixture(response([{revision:9,state:later,operation_replayed:true}])).api.write(flight(sent),base)).state,later);
  const restore={restore:true,state:base,payload:{p_domain:'orders',p_document_name:'main',p_expected_revision:4,p_operation_id:'restore-op',p_backup_id:1}};
  assert.equal((await fixture(response([{revision:5,state:sent,operation_replayed:false}])).api.write(restore,base)).revision,5);
  assert.equal((await fixture(response([{revision:4,state:base,operation_replayed:false}])).api.write(restore,base)).revision,4);
});

test('persisted flight identity/state is checked without rewriting accepted retry bytes',async()=>{
  for(const value of [null,true,'flight',{}, {payload:null},{payload:flight().payload,state:{}}]){
    const f=fixture(response([]));await assert.rejects(f.api.write(value,book()));assert.equal(f.requests.length,0);
  }
  for(const mutate of [value=>{value.payload.p_domain='kupa'},value=>{value.payload.p_document_name='other'},
    value=>{value.payload.p_operation_id=''},value=>{value.payload.p_expected_revision=true},
    value=>{value.payload.p_state=book('mismatch')},value=>{value.restore='true'}]){
    const value=flight(),f=fixture(response([]));mutate(value);
    await assert.rejects(f.api.write(value,book()));assert.equal(f.requests.length,0);
  }
  const value=flight(),f=fixture(response([{revision:5,state:value.state,operation_replayed:false}]));
  await f.api.write(value,book());assert.equal(f.requests[0].options.body,JSON.stringify(value.payload));
  assert.equal(f.requests[0].options.networkRetry,true);assert.equal(f.requests[0].options.dataPriority,'normal');
  assert.equal(typeof f.requests[0].options.assertRequestScope,'function');
});

test('implementation mutations expose ambiguous ACK acceptance and missing body-scope fencing',async()=>{
  const {readFileSync}=await import('node:fs'),source=readFileSync('shared/spreadsheet-remote.js','utf8');
  const mutate=async(from,to)=>{
    assert.ok(source.includes(from));
    return (await import('data:text/javascript;base64,'+Buffer.from(source.replace(from,to)).toString('base64'))).createSpreadsheetRemote;
  };
  const firstOnly=await mutate("if(value.length!==1)invalid('row count');",'');
  const ack={revision:5,state:book('sent'),operation_replayed:false};
  assert.equal((await fixture(response([ack,ack]),firstOnly).api.write(flight(),book())).revision,5);
  const uncheckedBody=await mutate('body=await response.text();assertCurrent();','body=await response.text();');
  let f;f=fixture({ok:true,status:200,text:async()=>{f.invalidate();return JSON.stringify([{revision:4,state:book()}])}},uncheckedBody);
  assert.equal((await f.api.readDocument()).revision,4,'negative implementation returns data after scope loss');
});

for(const phase of ['request','body'])for(const rejected of [false,true])test(`scope brackets ${phase} ${rejected?'rejection':'success'}`,async()=>{
  const entered=gate(),held=gate();let changed=false,bodyReads=0;
  const guard=()=>{if(changed)throw Object.assign(new Error('scope changed'),{code:'fixture_scope_changed'})};
  const api=createSpreadsheetRemote({domain:'orders',access:{capture:()=>guard},decodeState:assertSpreadsheet,equalState:equalSyncJson,
    request:async()=>{
      if(phase==='request'){entered.resolve();await held.promise}
      return {ok:true,status:200,text:async()=>{bodyReads++;if(phase==='body'){entered.resolve();await held.promise}return JSON.stringify([{revision:4,state:book()}])}};
    }});
  const task=api.readDocument();await entered.promise;changed=true;
  if(rejected)held.reject(new Error('network failure'));else held.resolve();
  await assert.rejects(task,{code:'fixture_scope_changed'});assert.equal(bodyReads,phase==='request'?0:1);
});

test('backup catalog is scoped and validated independently of document ACKs',async()=>{
  const valid={id:7,revision:4,created_at:'2026-10-15T12:00:00Z',kind:'edit'};
  assert.deepEqual(await fixture(response([valid])).api.backups(),[valid]);
  for(const rows of [null,{},[valid,valid],[{...valid,id:true}],[{...valid,id:1.5}],
    [{...valid,revision:0}],[{...valid,created_at:'invalid'}],[{...valid,kind:'unexpected'}],Array(41).fill(valid)]){
    await assert.rejects(fixture(response(rows)).api.backups(),{code:'SPREADSHEET_RESPONSE_INVALID'});
  }
  const f=fixture(response([valid]));f.invalidate();await assert.rejects(f.api.backups(),{code:'fixture_scope_changed'});
  assert.equal(f.requests.length,0);
});

for(const [app,create] of [['kupa',createKupa],['orders',createOrders]]){
  function syncFixture(){
    const db=new Map(),calls=[];let remote=book(),reply=null;
    const f={owner:'A',epoch:1,primary:true,online:true,enabled:true,db,calls,reply:value=>{reply=value}};
    const store={load:async key=>({record:structuredClone(db.get(key)||null),drafts:[]}),commit:async(key,value)=>{db.set(key,structuredClone(value))},journal:async()=>{},saveEmergency:()=>true,readEmergency:()=>[]};
    f.create=()=>create({domain:app,store,account:()=>f.owner,accountScope:()=>({owner:f.owner,epoch:f.epoch}),primary:()=>f.primary,
      online:()=>f.online,enabled:()=>f.enabled,setTimer:()=>0,clearTimer:()=>{},request:async(path,options)=>{
        if(!options.method)return response([{revision:4,state:remote}]);
        calls.push(options.body);const payload=JSON.parse(options.body);remote=payload.p_state;
        return reply?reply(payload):response([{revision:5,state:remote,operation_replayed:false}]);
      }});
    return f;
  }
  test(`${app}: malformed ACK retains the exact durable flight and valid retry reuses its payload`,async()=>{
    const f=syncFixture(),sync=f.create();await sync.open();
    sync.model.state.notesSheet.rows[0].cells['sheet-main-col-1']='changed';sync.changed();
    f.reply(payload=>response([{revision:4,state:payload.p_state,operation_replayed:false}]));
    assert.equal(await sync.flush(),false);assert.equal(sync.revision,4);assert.equal(sync.status,'pending');
    const pending=f.db.get(`A:${app}:main`);assert.ok(pending.flight);assert.equal(pending.base.rows[0].cells['sheet-main-col-1'],'base');
    f.reply(null);assert.equal(await sync.flush(),true);assert.equal(sync.revision,5);
    assert.equal(f.calls[0],f.calls[1]);assert.equal(f.db.get(`A:${app}:main`).flight,null);
  });
  test(`${app}: A/B/A replacement while ACK body is held cannot clear pending work`,async()=>{
    const f=syncFixture(),sync=f.create(),entered=gate(),held=gate();await sync.open();
    sync.model.state.notesSheet.rows[0].cells['sheet-main-col-1']='changed';sync.changed();
    f.reply(payload=>({ok:true,status:200,text:async()=>{entered.resolve();await held.promise;return JSON.stringify([{revision:5,state:payload.p_state,operation_replayed:false}])}}));
    const task=sync.flush();await entered.promise;f.owner='B';f.epoch++;f.owner='A';f.epoch++;held.resolve();
    assert.equal(await task,false);assert.equal(sync.revision,4);assert.ok(f.db.get(`A:${app}:main`).flight);
    assert.match(sync.error,/הרשאת העריכה השתנו/);assert.equal(f.db.has(`B:${app}:main`),false);
  });
  test(`${app}: going offline after accepted work does not revoke a valid ACK`,async()=>{
    const f=syncFixture(),sync=f.create();await sync.open();sync.model.state.notesSheet.rows[0].cells['sheet-main-col-1']='changed';sync.changed();
    f.reply(payload=>{f.online=false;return response([{revision:5,state:payload.p_state,operation_replayed:false}])});
    assert.equal(await sync.flush(),true);assert.equal(sync.revision,5);assert.equal(f.db.get(`A:${app}:main`).flight,null);
  });
}
