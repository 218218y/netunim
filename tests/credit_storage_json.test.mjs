import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as orders from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import * as kupa from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {assertStorageJson} from '../shared/storage-json-codec.js';

for(const [app,api]of Object.entries({orders,kupa})){
  test(`${app}: absent categories never turn valid credit JSON into undefined checkpoint fields`,()=>{
    for(const category of [undefined,null,'','   ']){
      const input={id:'issuer-tx',chargedAmount:12.34,date:'2026-10-20',processedDate:'2026-10-20',...(category===undefined?{}:{category})};
      const row=api.normalizeCreditTransaction(input);
      assert.equal(Object.hasOwn(row,'category'),false);
      assert.doesNotThrow(()=>assertStorageJson(row));
      assert.deepEqual(row,JSON.parse(JSON.stringify(row)));
      assert.equal(row.id,'issuer-tx');assert.equal(row.chargedAmount,12.34);
    }
    const row=api.normalizeCreditTransaction({category:'  ציוד   לבית  '});
    assert.equal(row.category,'ציוד לבית');assert.doesNotThrow(()=>assertStorageJson(row));
  });
  test(`${app}: monthly, pending and unassigned credit transactions survive a JSON checkpoint round-trip`,()=>{
    const input={version:4,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'synthetic-card',
      months:[{month:'2026-10',status:'fresh',fetchStatus:'success',transactions:[{id:'billed',chargedAmount:12,date:'2026-10-20',processedDate:'2026-10-20'}]}],
      pendingTransactions:[{id:'pending',status:'pending',originalAmount:5}],unassignedTransactions:[{id:'unassigned',chargedAmount:-3}]}]}]};
    const normalized=api.normalizeCreditSync(input);
    assert.doesNotThrow(()=>assertStorageJson(normalized));
    const restored=api.normalizeCreditSync(JSON.parse(JSON.stringify(normalized)));
    assert.deepEqual(restored,normalized);
    assert.deepEqual(restored.profiles[0].accounts[0].txns.map(row=>row.id).sort(),['billed','pending','unassigned']);
  });
}
