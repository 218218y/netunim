import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeFixture} from './edge_handler_fixture.mjs';

const owner='00000000-0000-4000-8000-000000000001';
function invoke(f,action,extra={}) {
  return f.handler(new Request('https://example.supabase.co/functions/v1/morning-documents',{
    method:'POST',headers:{Authorization:'Bearer synthetic-user','Content-Type':'application/json'},
    body:JSON.stringify({action,...extra})
  }));
}
test('issuance denies ordinary users, readers, reporters and forged grants before database or upstream access',async()=>{
  for(const user of [{id:owner},{id:owner,user_metadata:{morning_documents_write:true}},
    {id:owner,app_metadata:{morning_documents:true,morning_reports:true}},
    {id:owner,app_metadata:{morning_documents_write:'true'}}]) {
    const f=await edgeFixture('morning-documents',{user,env:{MORNING_DOCUMENT_USER_IDS:owner,MORNING_REPORT_USER_IDS:owner}});
    for(const action of ['reserve','preview','create','abandon_reservation']) {
      const response=await invoke(f,action,{user_id:owner,app_metadata:{morning_documents_write:true}});
      assert.equal(response.status,403,action);
      assert.equal((await response.json()).code,'morning_document_write_forbidden');
    }
    assert.equal(f.requests.length,0);assert.equal(f.operations.length,0);
  }
});
test('only explicit server grants allow issuance validation and user IDs match exactly',async()=>{
  for(const options of [{user:{id:owner,app_metadata:{morning_documents_write:true}}},
    {user:{id:owner},env:{MORNING_DOCUMENT_WRITE_USER_IDS:`other, ${owner}`}}]) {
    const f=await edgeFixture('morning-documents',{...options,env:{MORNING_CLIENT_ID:'test',MORNING_CLIENT_SECRET:'test',...options.env}});
    for(const action of ['reserve','preview','create','abandon_reservation'])assert.equal((await invoke(f,action)).status,400,action+' reaches input validation');
    assert.equal(f.requests.length,0);assert.equal(f.operations.length,0);
  }
  const f=await edgeFixture('morning-documents',{user:{id:owner},env:{MORNING_DOCUMENT_WRITE_USER_IDS:owner+'0'}});
  assert.equal((await invoke(f,'create')).status,403);
});
test('missing Morning environment never selects production',async()=>{
  const f=await edgeFixture('morning-documents',{env:{MORNING_ENV:undefined}});
  const response=await invoke(f,'status');
  assert.equal((await response.json()).environment,'sandbox');
  assert.equal(f.requests.length,0);
});
