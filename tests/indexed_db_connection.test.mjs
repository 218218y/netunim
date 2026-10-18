import test from 'node:test';
import assert from 'node:assert/strict';
import {createIndexedDbConnection} from '../shared/indexed-db-connection.js';

function fixture(options={}){
  const requests=[],factory={open(){const request={};requests.push(request);return request}};
  return {requests,open:createIndexedDbConnection('isolated',1,()=>{},{indexedDB:factory,...options})};
}
const connection=()=>({closes:0,close(){this.closes++}});
const succeed=(request,db)=>{request.result=db;request.onsuccess()};

test('blocked opens fail visibly and close late results without replacing a newer connection',async()=>{
  const {open,requests}=fixture();
  const pending=open();assert.equal(open(),pending);
  requests[0].onblocked();await assert.rejects(pending,/upgrade_blocked/);
  const retry=open(),newer=connection();succeed(requests[1],newer);assert.equal(await retry,newer);
  const late=connection();succeed(requests[0],late);
  assert.equal(late.closes,1);assert.equal(await open(),newer);
});

test('versionchange stops the workbook owner until reload; forced close allows a later retry',async()=>{
  const {open,requests}=fixture({stopOnVersionChange:true});
  const first=open(),db=connection();succeed(requests[0],db);await first;
  db.onclose();const second=open(),next=connection();succeed(requests[1],next);await second;
  db.onclose();assert.equal(await open(),next,'late close cannot evict the newer cache');
  next.onversionchange();assert.equal(next.closes,1);
  await assert.rejects(open(),/reload_required/);assert.equal(requests.length,2);
});
