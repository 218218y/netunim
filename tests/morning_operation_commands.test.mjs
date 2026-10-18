import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeMorningOperationStatus,decodeMorningReservation,decodeMorningCreatedDocument,decodeMorningAbandonment,decodeMorningOperationFailure} from '../netunim-orders/site/assets/js/domains/customers/morning-operation-evidence.js';
import {createMorningOperationCommands} from '../netunim-orders/site/assets/js/domains/customers/morning-operation-commands.js';
import {createMorningIssuance} from '../netunim-orders/site/assets/js/domains/customers/morning-issuance.js';
const OP='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',guard=()=>{},invalid={code:'morning_operation_response_invalid'};
const payload=()=>({operation_id:OP,document:{type:320,amount:42}});
const ledger=()=>({operation_id:OP,state:'created',document_id:'historical-document',document_type:320,amount:'42.00',document_number:'4001',verified_at:'2026-10-14T00:00:00Z'});

test('only an explicit manual check asks to bypass the cheque follow-up cooldown',async()=>{
  const requests=[],commands=createMorningOperationCommands({request:{json:async(action,body)=>{requests.push({action,body});return {ok:true,operation:ledger()}}}});
  await commands.status(OP,true,guard);await commands.status(OP,true,guard,true);
  assert.equal(requests[0].body.retry_checks,undefined);assert.equal(requests[1].body.retry_checks,true);
});

test('current ledger evidence decodes decimal SQL text and retains historical document identities',()=>{
  const status=decodeMorningOperationStatus({ok:true,configured:true,environment:'sandbox',operation:ledger(),bank_link:{pending:false}},OP);
  assert.equal(status.operation.amount,42);assert.equal(status.operation.document_id,'historical-document');assert.equal(status.operation.document_number,'4001');
  assert.deepEqual(decodeMorningOperationStatus({ok:true,configured:false,environment:'invalid-setting',operation:null},''),{ok:true,configured:false,environment:'invalid-setting',operation:null});
  for(const state of ['reserved','pending','created_unverified','needs_reconciliation','failed'])assert.equal(decodeMorningOperationStatus({ok:true,operation:{operation_id:OP,state}},OP).operation.state,state);
});
for(const [name,value] of [
  ['missing success',{operation:null}],['non-object',[]],['truthy configuration',{ok:true,configured:'true'}],
  ['unknown state',{ok:true,operation:{operation_id:OP,state:'creating'}}],
  ['missing document',{ok:true,operation:{...ledger(),document_id:null}}],
  ['unverified created row',{ok:true,operation:{...ledger(),verified_at:null}}],
  ['truthy verification date',{ok:true,operation:{...ledger(),verified_at:true}}],
  ['formatted currency',{ok:true,operation:{...ledger(),amount:'₪42'}}],
  ['sub-cent evidence',{ok:true,operation:{...ledger(),amount:42.001}}],
  ['invented reservation state',{ok:true,retryable_reserved:true,operation:ledger()}],
  ['foreign Bank operation',{ok:true,operation:ledger(),bank_link:{operationId:OTHER}}],
  ['foreign Bank document',{ok:true,operation:ledger(),bank_link:{documentId:'other-document'}}],
  ['contradictory Bank completion',{ok:true,operation:ledger(),bank_link_pending:false,bank_link:{pending:true}}],
])test(`unknown operation status rejects ${name}`,()=>assert.throws(()=>decodeMorningOperationStatus(value,OP),invalid));

test('reservation and abandonment require identity and literal confirmation before cleanup',()=>{
  assert.equal(decodeMorningReservation({ok:true,reserved:true,operation:{operation_id:OP,state:'reserved'}},OP).reserved,true);
  for(const value of [{ok:true,reserved:'yes',operation:{operation_id:OP,state:'reserved'}},{ok:true,reserved:true,operation:{operation_id:OTHER,state:'reserved'}}])assert.throws(()=>decodeMorningReservation(value,OP),invalid);
  assert.equal(decodeMorningAbandonment({ok:true,abandoned:true,operation:{operation_id:OP,state:'failed'}},OP).abandoned,true);
  for(const value of [{ok:true,abandoned:true,operation:null},{ok:true,abandoned:true,operation:{operation_id:OP,state:'pending'}},{ok:true,abandoned:true,operation:{operation_id:OTHER,state:'failed'}}])assert.throws(()=>decodeMorningAbandonment(value,OP),invalid);
  assert.equal(decodeMorningAbandonment({ok:true,abandoned:false,operation:null},OP).abandoned,false);
});

test('official creation requires canonical matching type/amount and consistent Bank evidence',()=>{
  const response={ok:true,verified:true,document:{id:'historical-document',type:320,amount:42,number:4001}};
  assert.equal(decodeMorningCreatedDocument(response,payload()).document.number,4001);
  for(const value of [{...response,verified:'true'},{...response,document:{...response.document,id:true}},{...response,document:{...response.document,type:305}},{...response,document:{...response.document,amount:43}},{...response,local_link_pending:'false'},{...response,bank_link:{documentAmount:1}}])assert.throws(()=>decodeMorningCreatedDocument(value,payload()),invalid);
});

test('valid deduplication errors retain prior operation identity and retry semantics',()=>{
  const failure=decodeMorningOperationFailure(Object.assign(Error('Already verified'),{code:'morning_similar_operation_verified',status:409,details:{operation_id:OTHER,prevent_retry:true,uncertain:false,document:{id:'historical-document',number:'4001'}}}));
  assert.equal(failure.message,'Already verified');assert.equal(failure.status,409);assert.equal(failure.details.operation_id,OTHER);assert.equal(failure.details.prevent_retry,true);
  assert.equal(decodeMorningOperationFailure(Error('response lost')).message,'response lost');
  for(const details of [{prevent_retry:'false'},{uncertain:0},{operation_id:true},{operation_id:'non-UUID'},{document:{id:true}}])assert.throws(()=>decodeMorningOperationFailure(Object.assign(Error('bad rejection'),{status:400,details})),invalid);
});

test('malformed post-create rejection cannot authorize abandonment or erase accepted recovery',async()=>{
  const calls=[];let context;
  const commands=createMorningOperationCommands({request:{json:async(action,input)=>{calls.push(action);if(action==='reserve')return {ok:true,reserved:true,operation:{operation_id:input.operation_id,state:'reserved'}};throw Object.assign(Error('bad rejection'),{status:400,details:{uncertain:'false'}})}}});
  const issuer=createMorningIssuance({commands,recovery:{persist:value=>{context=value},reset:()=>assert.fail('malformed rejection cannot erase recovery'),block(){}}}),original={operationId:OP};
  await assert.rejects(issuer.issue(payload(),original,guard),error=>error.code===invalid.code&&error.status===undefined);
  assert.equal(context,original);assert.deepEqual(calls,['reserve','create']);
});

test('an operation command binds expected identity before awaiting an external body',async()=>{
  let release;const body=new Promise(resolve=>{release=resolve}),input=payload();
  const commands=createMorningOperationCommands({request:{json:async()=>body}}),work=commands.reserve(input,guard);input.operation_id=OTHER;
  release({ok:true,reserved:true,operation:{operation_id:OTHER,state:'reserved'}});await assert.rejects(work,invalid);
});
