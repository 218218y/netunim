import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTransport as orders} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createCloudTransport as kupa} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {createBankArchiveCommands} from '../netunim-orders/site/assets/js/domains/finance/bank-archive-commands.js';
import {readBankArchiveRows,readBankSnapshotRows,readBankMorningLinkRows} from '../shared/bank-response-records.js';

const at='2026-10-16T10:00:00Z',key='12-655-1';
const response=body=>({ok:true,json:async()=>body,text:async()=>JSON.stringify(body)});
const archive={id:77,account_key:key,account_role:'business',merge_key:'K',amount:'100.50',currency:'ILS',status:'completed',
  first_seen_at:at,transaction_date:null,processed_date:null,last_seen_at:null,missing_since:null,missing_acknowledged_at:null,
  presence_state:'unknown',alert_acknowledgements:{},cheque:false,balance_after:null};
const snapshot={account_key:key,account_role:'business',snapshot_at:at,coverage_from:'2026-10-01',coverage_to:'2026-10-16',
  transaction_count:1,transactions:[{mergeKey:'K',amount:100,date:at}]};
const link={transaction_id:77,link_id:3,operation_id:'operation',document_id:'document',document_type:320,document_amount:'100.50',verified_at:at};
const invalid={code:'BANK_RESPONSE_EVIDENCE_INVALID'};

for(const [app,create] of [['orders',orders],['kupa',kupa]]){
  const transport=body=>create({session:{cloudDocumentName:'main'},supaFetch:async()=>response(body),supaRest:async()=>response(body)});
  for(const [method,args,good] of [
    ['acknowledgeBankTransactionMissing',[77],{transaction_id:77,acknowledged_at:at}],
    ['acknowledgeBankTransactionAlert',[77,'returned_cheque'],{transaction_id:77,alert_kind:'returned_cheque',acknowledged_at:at}],
    ...(app==='orders'?[
      ['setBankTransactionHandled',[77,true],{transaction_id:77,handled_at:at}],
      ['setBankTransactionHandled',[77,false],{transaction_id:77,handled_at:null}],
    ]:[]),
  ])test(`${app} ${method} ${args}: only a matching single receipt grants confirmation`,async()=>{
    const timeField=method==='setBankTransactionHandled'?'handled_at':'acknowledged_at';
    const bad=[null,{},[],[good,good],good,[{}],[{...good,transaction_id:78}],[{...good,[timeField]:'2026-02-30T10:00:00Z'}],
      [{...good,[timeField]:undefined}]];
    if(args[1]===false)bad.push([{...good,handled_at:at}]);
    else bad.push([{...good,[timeField]:null}]);
    if(method==='acknowledgeBankTransactionAlert')bad.push([{...good,alert_kind:'other'}]);
    for(const body of bad)await assert.rejects(transport(body)[method](...args),invalid);
    const accepted=await transport([good])[method](...args);
    assert.equal(accepted.transaction_id,77);assert.equal(accepted[timeField],good[timeField]);
  });
  test(`${app}: malformed archive/snapshot HTTP success rejects, valid empty reads stay empty`,async()=>{
    for(const body of [null,{},[null],[{}]]){
      await assert.rejects(transport(body).readBankTransactions(key,'business'),invalid);
      await assert.rejects(transport(body).readBankTransactionSnapshot(key,'business'),invalid);
    }
    assert.deepEqual(await transport([]).readBankTransactions(key,'business'),[]);
    assert.equal(await transport([]).readBankTransactionSnapshot(key,'business'),null);
    for(const patch of [{account_key:'other'},{account_role:'home'},{amount:''},{amount:true},{id:'77'},
      {first_seen_at:'bad'},{presence_state:['present']},{alert_acknowledgements:[]},{alert_acknowledgements:{returned_cheque:'bad'}}]){
      await assert.rejects(transport([{...archive,...patch}]).readBankTransactions(key,'business'),invalid);
    }
    for(const patch of [{account_key:'other'},{snapshot_at:'bad'},{coverage_from:'2026-02-30'},
      {transaction_count:0},{transactions:{}},{transactions:[{mergeKey:'K',amount:null}]}]){
      await assert.rejects(transport([{...snapshot,...patch}]).readBankTransactionSnapshot(key,'business'),invalid);
    }
  });
}

test('archive duplicate identities, Morning link corruption and snapshot cardinality fail closed',()=>{
  const seen=new Set();readBankArchiveRows([archive],key,'business',seen);
  assert.throws(()=>readBankArchiveRows([archive],key,'business',seen),invalid);
  assert.throws(()=>readBankSnapshotRows([snapshot,snapshot],key,'business'),invalid);
  assert.throws(()=>readBankMorningLinkRows([link,link]),invalid);
  for(const body of [null,{},[null],[{...link,transaction_id:0}],[{...link,document_amount:false}],[{...link,verified_at:'bad'}]]){
    assert.throws(()=>readBankMorningLinkRows(body),invalid);
  }
  assert.equal(readBankMorningLinkRows([link])[0].verified_at,at);
});

test('Orders invalid server acknowledgement never mutates the archive or displays success',async()=>{
  for(const body of [null,{},[],[{transaction_id:78,acknowledged_at:at}],[{transaction_id:77,acknowledged_at:'bad'}]]){
    const transport=orders({supaFetch:async()=>response(body)}),messages=[];
    let updates=0;
    const commands=createBankArchiveCommands({operationScope:{capture:()=>()=>{}},
      transport:{...transport,saveBankTransactionHandled:transport.setBankTransactionHandled},
      archive:{update:()=>{updates++}},toast:message=>messages.push(message)});
    assert.equal(await commands.acknowledgeMissingBankTransaction(77),false);
    assert.equal(await commands.acknowledgePersistentBankAlert(77,'returned_cheque'),false);
    assert.equal(await commands.toggleBankTransactionHandled(77,true),false);
    assert.equal(updates,0);assert.equal(messages.length,3);
    assert.ok(messages.every(message=>message.includes('לא התקבל אישור תקין')));
  }
});
