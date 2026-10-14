import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {declaration} from './bank_policy_ast_fixture.mjs';
import {morningStatusMessage} from '../netunim-orders/site/assets/js/domains/customers/morning-status-message.js';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/morning-status-policy.json',import.meta.url),'utf8'));
test('864 connection/recovery presentations preserve the immutable status-message decisions',()=>{
  const outputs=[];
  for(const configured of [undefined,false,true])for(const available of [undefined,false,true])for(const environment of [undefined,'production','sandbox'])for(const blocked of [false,true])for(const recoveryStillPending of [false,true])for(const recoveryCleanupPending of [false,true])for(const retryable_reserved of [false,true])for(const operation of [null,{operation_id:'bound-ID',state:'pending'}])outputs.push(morningStatusMessage({configured,available,environment,retryable_reserved,operation},{blocked,recoveryStillPending,recoveryCleanupPending}));
  assert.equal(outputs.length,baseline.messageCases);assert.equal(createHash('sha256').update(JSON.stringify(outputs)).digest('hex'),baseline.messageDigest,'status policy changed from '+baseline.commit);
});
test('status execution has six ports and no DOM, raw model, JSON transport or local persistence',()=>{
  const source=readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/morning-status.js',import.meta.url),'utf8');
  assert.equal(declaration(source,'createMorningStatus').params[0].properties.length,6);
  for(const name of ['customerDebts','localStorage','document.','supaFetch','request.json','commitSave','setTimeout'])assert.equal(source.includes(name),false);
});
