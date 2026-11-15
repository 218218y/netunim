import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCreditSyncResult as kupa} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {mergeCreditSyncResult as orders} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {creditBillingRowsData} from '../shared/credit-billing-cycles.js';
const tx=id=>({id,status:'completed',date:'2026-11-01T00:00:00Z',processedDate:null,
  originalAmount:-365,originalCurrency:'ILS',chargedAmount:-365,chargedCurrency:'ILS',description:'Synthetic'});
const payload=(unassignedTransactions,transactions=[])=>({syncedAt:'2026-11-15T10:00:00Z',profiles:[{
  profileId:'P',provider:'max',coreComplete:true,accounts:[{accountNumber:'C',unassignedTransactions,
    months:[{month:'2026-12',fetchStatus:'success',fetchedAt:'2026-11-15T10:00:00Z',transactions}]}]}]});
for(const [name,merge] of [['kupa',kupa],['orders',orders]]){
  const initial=rows=>merge({cardMappings:{'P:C':{included:true}}},payload(rows));
  test(name+' partial and empty unassigned reads preserve every prior source and report incomplete core',()=>{
    const old=initial([tx('A'),tx('B')]),before=JSON.stringify(old);
    for(const rows of [[tx('B')],[]]){
      const result=merge(old,payload(rows)),account=result.profiles[0].accounts[0];
      assert.deepEqual(account.unassignedTransactions.map(row=>row.id),['A','B']);
      assert.equal(result.errors[0].code,'CREDIT_UNASSIGNED_REGRESSION');
      assert.equal(result.profiles[0].coreComplete,false);
      assert.equal(JSON.stringify(old),before);
      assert.equal(merge(JSON.parse(JSON.stringify(result)),payload([tx('A'),tx('B')])).errors.length,0);
    }
  });
  test(name+' a verified assignment removes the active source and preserves its audit copy exactly once',()=>{
    const old=initial([tx('A')]),assigned={...tx('A'),processedDate:'2026-12-10T00:00:00Z'};
    const result=merge(old,payload([], [assigned])),account=result.profiles[0].accounts[0];
    assert.equal(account.unassignedTransactions.length,0);assert.equal(result.errors.length,0);
    assert.equal(account.unassignedTransfers.length,1);
    assert.equal(account.unassignedTransfers[0].transaction.processedDate,null);
    assert.equal(creditBillingRowsData({creditSync:result},{asOf:'2026-11-15'}).filter(row=>row.creditId.includes('|A|')).length,1);
    const replay=merge(JSON.parse(JSON.stringify(result)),payload([], [assigned]));
    assert.equal(replay.profiles[0].accounts[0].unassignedTransfers.length,1);
  });
  test(name+' a reused issuer ID with different source money cannot authorize a transfer or double charge',()=>{
    const old=initial([tx('A')]);
    const result=merge(old,payload([],[{...tx('A'),originalAmount:-999,processedDate:'2026-12-10T00:00:00Z'}]));
    assert.equal(result.errors[0].code,'CREDIT_UNASSIGNED_REGRESSION');
    assert.equal(result.profiles[0].accounts[0].months[0].transactions.length,0);
    assert.equal(result.profiles[0].accounts[0].unassignedTransactions.length,1);
  });
  test(name+' preserves anonymous multiplicity and permits newly reported FX conversion on proven assignment',()=>{
    const old=initial([tx(''),tx('')]);
    assert.equal(merge(old,payload([tx('')])).profiles[0].accounts[0].unassignedTransactions.length,2);
    const fx={...tx('FX'),originalCurrency:'USD',chargedAmount:null};
    const result=merge(initial([fx]),payload([],[{...fx,chargedAmount:-1400,processedDate:'2026-12-10T00:00:00Z'}]));
    assert.equal(result.profiles[0].accounts[0].unassignedTransactions.length,0);
    assert.equal(result.errors.length,0);
  });
}
