import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256,readFinanceBackup,financeBackup,creditVersionDiff} from '../shared/finance-history-model.js';
import {createFinanceHistoryService} from '../shared/finance-history-service.js';
const tx={id:'T',date:'2026-10-01',processedDate:'2026-10-10',originalAmount:-100,originalCurrency:'ILS',chargedAmount:-100,chargedCurrency:'ILS'};
const source=rows=>({bank:{balance:100},creditSync:{version:4,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'1234',months:[{month:'2026-10',transactions:rows}],unassignedTransactions:[]}]}]}});
async function fixture(){
  const target=source([tx]),wire=JSON.stringify(target),hash=await sha256(wire),calls=[],files=[];let live={revision:5,state:source([{...tx,id:'other'}])},active=true,closed=0;
  live.state.bank.balance=900;
  const guard=()=>assert.equal(active,true,'former owner rejected');
  const request=async(path,options)=>{guard();const args=JSON.parse(options.body);calls.push({path,args});
    if(path.endsWith('export_finance_document_version'))return Response.json([{revision:2,state_text:wire,state_hash:hash}]);
    if(path.endsWith('list_finance_document_versions'))return Response.json([{revision:2}]);
    live={revision:6,state:{...live.state,creditSync:target.creditSync}};
    return Response.json([{...live,operation_revision:6,operation_replayed:false}]);
  };
  const leases={commands:{acquire:()=>({ready:Promise.resolve({acquired:true,leaseName:'credit',leaseToken:'owned',fenceEpoch:7,assertCurrent:guard}),close:async()=>{closed++}})}};
  const service=createFinanceHistoryService({request,leases,capture:()=>guard,readHead:async()=>structuredClone(live),refresh:async()=>({verified:true}),saveJson:async(name,body)=>files.push({name,body})});
  return {service,target,guard,calls,files,closed:()=>closed,live:()=>live,change:()=>{live.revision++},handoff:()=>{active=false}};
}
test('portable export validates original wire bytes, financial shape and tampering',async()=>{
  const state=source([tx]),text=JSON.stringify(state),backup=await financeBackup({revision:2,state_text:text,state_hash:await sha256(text)});
  assert.deepEqual(await readFinanceBackup(JSON.parse(JSON.stringify(backup))),state);
  await assert.rejects(readFinanceBackup({...backup,stateText:text+' '}));
  await assert.rejects(readFinanceBackup({...backup,revision:0}));
  const invalid=JSON.stringify({creditSync:{profiles:'invalid'}});
  await assert.rejects(readFinanceBackup({...backup,stateText:invalid,sha256:await sha256(invalid)}));
});
test('comparison detects equal-total replacements and preserves duplicate multiplicity',()=>{
  const diff=creditVersionDiff(source([tx,tx]),source([{...tx,id:'other'},tx]));
  assert.equal(diff.beforeCount,2);assert.equal(diff.afterCount,2);assert.equal(diff.changes.length,2);
  assert.equal(diff.groups[0].before.ilsCents,diff.groups[0].after.ilsCents);
});
test('preview, verified file export and Credit-only restore keep current Bank and close the lease',async()=>{
  const f=await fixture(),preview=await f.service.preview(2,f.guard);await f.service.exportVersion(preview,f.guard);
  assert.deepEqual(await readFinanceBackup(f.files[0].body),f.target);
  const result=await f.service.restore(preview,'Verified issuer reconciliation',f.guard);
  assert.equal(result.displayConfirmed,true);assert.equal(f.live().state.bank.balance,900);assert.equal(f.closed(),1);
  const write=f.calls.find(call=>call.path.endsWith('restore_finance_credit_version'));
  assert.equal(write.args.p_expected_revision,5);assert.equal(write.args.p_version,2);assert.equal(write.args.p_lease_token,'owned');
  assert.equal(write.args.p_credit_sync,undefined,'UI cannot submit arbitrary replacement data');
});
test('a changed head refuses stale restoration before any write and releases the lease',async()=>{
  const f=await fixture(),preview=await f.service.preview(2,f.guard);f.change();
  await assert.rejects(f.service.restore(preview,'Verified issuer reconciliation',f.guard),/השתנו/);
  assert.equal(f.calls.some(call=>call.path.endsWith('restore_finance_credit_version')),false);assert.equal(f.closed(),1);
});
test('owner handoff prevents old-account export and restoration',async()=>{
  const f=await fixture(),preview=await f.service.preview(2,f.guard);f.handoff();
  await assert.rejects(f.service.exportVersion(preview,f.guard));await assert.rejects(f.service.restore(preview,'Verified issuer reconciliation',f.guard));assert.equal(f.files.length,0);
});

test('discarded account previews cannot export or restore even under a later valid guard',async()=>{
  const f=await fixture(),preview=await f.service.preview(2,f.guard);f.service.clear();
  await assert.rejects(f.service.exportVersion(preview,()=>{}));await assert.rejects(f.service.restore(preview,'Verified issuer reconciliation',()=>{}));
  assert.equal(f.files.length,0);
});
