import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseOcr} from '../netunim-orders/supabase/functions/morning-expenses/ocr.js';
import {createExpenseService} from '../netunim-orders/supabase/functions/morning-expenses/service.js';
const id = n => `aaaaaaaa-aaaa-4aaa-aaaa-${String(n).padStart(12,'0')}`;
const user = {id:id(1),app_metadata:{morning_expenses_read:true,morning_expenses_write:true}};
const prepare = {action:'ocr_prepare',operationId:id(2),sha256:'a'.repeat(64),size:790,contentType:'application/pdf'};
function ocrFixture({environment = 'sandbox', enabled = true} = {}) {
  let clock = Date.parse('2026-10-27T08:00:00Z'), raws = [], mode = '';
  const rows = new Map(), calls = [], downloads = [];
  const ledger = {
    get:async (owner, operation) => {const row = rows.get(operation); return row?.owner_id === owner ? structuredClone(row) : null;},
    byFile:async (owner, hash) => {const row = [...rows.values()].find(row => row.owner_id === owner && row.file_sha256 === hash); return row ? structuredClone(row) : null;},
    list:async owner => [...rows.values()].filter(row => row.owner_id === owner).map(row => structuredClone(row)),
    reserve:async row => {if (rows.has(row.operation_id) || [...rows.values()].some(other => other.file_sha256 === row.file_sha256)) return null;
      const value = {...row,created_at:new Date(clock).toISOString()}; rows.set(row.operation_id, value); return structuredClone(value);},
    transition:async (owner, prior, patch) => {const row = rows.get(prior.operation_id); if (row?.owner_id !== owner || row.revision !== prior.revision) return null;
      if (mode === 'save-failed' && patch.state === 'ticket_issued') throw Error('storage failed');
      Object.assign(row, patch, {revision:row.revision + 1}); return structuredClone(row);},
  };
  const request = async (path, init) => {
    calls.push(path);
    if (path.startsWith('/file-upload/')) {
      if (mode === 'ticket-failed') throw Error('provider unavailable');
      return {url:'https://s3.eu-west-1.amazonaws.com/sandbox-file-upload-service-uploaded',maxFileSize:20971520,
        fields:{key:'2026/10/27/business/${filename}',Policy:'signed','X-Amz-Algorithm':'AWS4-HMAC-SHA256','X-Amz-Credential':'credential',
          'X-Amz-Date':'date','X-Amz-Security-Token':'token','X-Amz-Signature':'signature',bucket:'sandbox-file-upload-service-uploaded',
          'x-amz-meta-business-id':id(10),'x-amz-meta-file-context':'expense','x-amz-meta-file-data':'{"source":5}'}};
    }
    assert.equal(path, '/expenses/drafts/search', 'OCR must never call the financial writer or undocumented paths');
    const body = JSON.parse(init.body); assert.equal(body.fromDate, '2026-10-26');
    return {page:body.page,pageSize:50,pages:Math.ceil(raws.length/50),total:raws.length,items:raws.slice((body.page-1)*50,body.page*50)};
  };
  const options = {request,ledger,environment,enabled,now:() => clock,
    verifySource:async (raw, expected) => {downloads.push(raw.id); return raw.sha256 === expected.sha256;}};
  const draft = (n = 3, sha256 = prepare.sha256) => ({id:id(n),businessId:id(10),status:10,creationDate:Math.floor(clock/1000),sha256,
    expense:{number:'000123',amount:1160,vat:150,documentType:305,currency:'ILS',supplier:{name:'OCR supplier'}},url:'private-source'});
  return {ocr:createExpenseOcr(options), options,rows,calls,downloads,draft,setDrafts:value => raws=value,setMode:value => mode=value,tick:(ms=5001) => clock+=ms};
}
test('OCR reserves before issuing; concurrent tickets and lost delivery cannot replay even after expiry', async () => {
  const f = ocrFixture(); assert.equal((await f.ocr.handle(user, prepare)).status, 200); assert.equal(f.calls.length, 0);
  const replies = await Promise.all([1,2].map(() => f.ocr.handle(user,{action:'ocr_ticket',operationId:id(2)})));
  assert.equal(replies.filter(value => value.status === 200).length,1); assert.equal(f.calls.length,1);
  f.tick(3600000);
  assert.equal((await f.ocr.handle(user,{action:'ocr_ticket',operationId:id(2)})).status,409);
  const restored = await f.ocr.handle(user,{...prepare,operationId:id(9)});
  assert.equal(restored.body.operationId,id(2)); assert.equal(restored.body.state,'ticket_issued'); assert.equal(f.calls.length,1);
  assert.equal((await f.ocr.handle({...user,id:id(8)},{...prepare,operationId:id(9)})).status,409);
});
test('only an undelivered failed form can be retried; save failure never releases another revision', async () => {
  for (const mode of ['ticket-failed','save-failed']) {
    const f = ocrFixture(); await f.ocr.handle(user, prepare); f.setMode(mode);
    assert.equal((await f.ocr.handle(user,{action:'ocr_ticket',operationId:id(2)})).status,503);
    assert.equal(f.rows.get(id(2)).state,'reserved'); f.setMode('');
    assert.equal((await f.ocr.handle(user,{action:'ocr_ticket',operationId:id(2)})).status,200);
  }
});
test('exact source proof maps an OCR draft without claiming parsing, supplier or approval verification', async () => {
  const f = ocrFixture(); await f.ocr.handle(user,prepare); await f.ocr.handle(user,{action:'ocr_ticket',operationId:id(2)});
  f.setDrafts([f.draft()]);
  const result = await f.ocr.handle(user,{action:'ocr_status',operationId:id(2)});
  assert.equal(result.body.sourceVerified,true); assert.equal(result.body.draftId,id(3)); assert.equal(result.body.state,'review_required');
  assert.equal(result.body.item.vatCents,15000); assert.equal(result.body.item.supplier.verified,false);
  assert.equal(result.body.approvalVerified,false); assert.equal(result.body.parsingVerified,false);
  assert.ok(!JSON.stringify(result).includes('private-source')); assert.equal(f.downloads.length,1);
  const again = await f.ocr.handle(user,{action:'ocr_status',operationId:id(2)});
  assert.equal(again.body.code,'morning_ocr_cooldown'); assert.equal(f.downloads.length,1);
  assert.equal(Object.hasOwn(f.rows.get(id(2)),'expense_id'),false);
});
test('duplicate source matches and concurrent drafts never select a guessed ID; polling and search are bounded', async () => {
  const f = ocrFixture(); await f.ocr.handle(user,prepare); await f.ocr.handle(user,{action:'ocr_ticket',operationId:id(2)});
  f.setDrafts([f.draft(3),f.draft(4)]);
  assert.equal((await f.ocr.handle(user,{action:'ocr_status',operationId:id(2)})).body.code,'morning_ocr_ambiguous');
  assert.equal(f.rows.get(id(2)).draft_id,undefined);
  f.tick(); f.setDrafts([f.draft(3,'b'.repeat(64)),f.draft(4,'c'.repeat(64))]);
  assert.equal((await f.ocr.handle(user,{action:'ocr_status',operationId:id(2)})).body.code,'morning_ocr_waiting');
  f.tick(); f.setDrafts(Array.from({length:201},(_,n) => f.draft(n+100)));
  assert.equal((await f.ocr.handle(user,{action:'ocr_status',operationId:id(2)})).body.code,'morning_ocr_search_limit');
  f.rows.get(id(2)).poll_count=20; const count=f.calls.length;
  assert.equal((await f.ocr.handle(user,{action:'ocr_status',operationId:id(2)})).body.code,'morning_ocr_poll_limit'); assert.equal(f.calls.length,count);
});
test('OCR authorization, environment pinning and recovery remain separate from disabled writes and Production', async () => {
  const f=ocrFixture(); await f.ocr.handle(user,prepare); await f.ocr.handle(user,{action:'ocr_ticket',operationId:id(2)});
  const stopped=createExpenseOcr({...f.options,enabled:false}); f.setDrafts([f.draft()]);
  assert.equal(stopped.allowed(user),false); assert.equal((await stopped.handle(user,{action:'ocr_status',operationId:id(2)})).body.sourceVerified,true);
  assert.equal((await stopped.handle(user,prepare)).status,403);
  assert.equal((await stopped.handle({...user,id:id(9)},{action:'ocr_status',operationId:id(2)})).status,404);
  assert.equal((await stopped.handle({id:user.id,user_metadata:{morning_expenses_write:true}},prepare)).status,403);
  assert.equal(createExpenseOcr({...f.options,environment:'production',productionUserId:user.id}).allowed(user),false);
  const service=createExpenseService({request:f.options.request,environment:'sandbox',ocr:f.ocr});
  assert.equal((await service(user,{action:'ocr_list',expectedEnvironment:'production'})).status,409);
  const deferred=await stopped.handle(user,{action:'ocr_defer',operationId:id(2)}); assert.equal(deferred.body.deferred,true); assert.equal(deferred.body.approvalVerified,false);
});
