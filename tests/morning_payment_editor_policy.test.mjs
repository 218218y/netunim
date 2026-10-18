import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/morning-payment-editor-policy.json',import.meta.url),'utf8'));
const current=readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/morning-payments.js',import.meta.url),'utf8');
// Exact-cent increments and an explicit cheque due-date label are intentional
// additions, exercised by the browser/Edge tests; all other input policy stays.
const source=current.replaceAll('step="0.01"','step="1"')
  .replace('<label>תאריך תשלום / פירעון הצ׳ק</label>','<label>תאריך</label>')
  .replace("label:'תאריך תשלום / פירעון הצ׳ק'","label:'תאריך תשלום'");
for(const [name,expected] of Object.entries(baseline.functions))test(`scoped payment editor preserves ${name} financial/input policy`,()=>{
  const node=declaration(source,name),policy=tokens(source.slice(node.start,node.end)).replaceAll('paymentRows()',"[...document.querySelectorAll('[data-payment-row]')]").replaceAll("currentField('morningPaymentRows')?.querySelector(",'document.querySelector(');
  // Native JavaScript normalizes template line endings; checkout EOL is not policy.
  assert.equal(createHash('sha256').update(policy.replaceAll('\r\n','\n')).digest('hex'),expected,'policy drift from '+baseline.commit);
});
