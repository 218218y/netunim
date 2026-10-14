import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createMorningBankTransactionLinker} from '../netunim-orders/site/assets/js/domains/customers/morning-bank-transaction-link.js';
import {createMorningBankLinkForm} from '../netunim-orders/site/assets/js/domains/customers/morning-bank-link-form.js';
import {bankMorningEligibility,bankMorningPrefill} from '../netunim-orders/site/assets/js/domains/finance/bank-morning.js';
import {morningBankLinkPolicyCases} from './morning_bank_link_policy_cases.mjs';
import {declaration} from './bank_policy_ast_fixture.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/morning-bank-link-policy.json',import.meta.url),'utf8'));
test('576 Bank link and original-form restore decisions preserve the immutable policy',()=>{
  const outputs=morningBankLinkPolicyCases(e=>createMorningBankTransactionLinker({session:e.session,catalog:e.catalog,policy:{eligible:row=>bankMorningEligibility(row,'business'),prefill:bankMorningPrefill},form:createMorningBankLinkForm(e),presentation:e.presentation}));
  assert.equal(outputs.length,baseline.cases);assert.equal(createHash('sha256').update(JSON.stringify(outputs)).digest('hex'),baseline.digest,'Bank source/prefill/restore policy drift from '+baseline.commit);
});
test('Bank link execution has five ports and no DOM, raw model, provider or persistence implementation',()=>{
  const source=readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/morning-bank-transaction-link.js',import.meta.url),'utf8');
  assert.equal(declaration(source,'createMorningBankTransactionLinker').params[0].properties.length,5);
  for(const name of ['document.query','localStorage','customerDebts','request.json','supaFetch','setTimeout','setDateValue'])assert.equal(source.includes(name),false);
});
