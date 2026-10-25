import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSharedChecks,normalizeSharedBankEvents} from '../shared/shared-checks-contract.js';

test('shared check normalization rejects malformed identities and retains nullable deposit evidence',()=>{
  for(const rows of [[null],[{}],[{id:1}],[{id:''}],[{id:' A '}],[{id:'A'},{id:'A'}]])assert.throws(()=>normalizeSharedChecks(rows));
  const input=[{id:'A',amount:'123.456',depositSeq:null,depositedAt:{source:'unvalidated'}}];
  const [row]=normalizeSharedChecks(input);
  assert.equal(row.amount,123.46);assert.equal(row.depositSeq,null);assert.deepEqual(row.depositedAt,{source:'unvalidated'});
  assert.equal(input[0].amount,'123.456');
});
test('bank event admission requires a positive safe sequence and check identity, including under runtime mutation',async()=>{
  const input=[null,{},...[-1,0,1.5,Number.MAX_SAFE_INTEGER+1].map(seq=>({seq,checkId:'C'})),{seq:1,checkId:''},{seq:2,checkId:'C',delta:'1.235'}];
  assert.deepEqual(normalizeSharedBankEvents(input),[{seq:2,checkId:'C',delta:1.24,at:null,kind:'check_effect_delta'}]);
  const file=new URL('../shared/shared-checks-contract.js',import.meta.url),source=readFileSync(file,'utf8');
  const changed=source.replace('event=>!!event.seq&&!!event.checkId','event=>true');assert.notEqual(changed,source);
  const absolute=changed.replace("'./data-invariants.js'",JSON.stringify(new URL('../shared/data-invariants.js',import.meta.url).href));
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(absolute).toString('base64'));
  assert.equal(mutant.normalizeSharedBankEvents([{seq:0,checkId:'C'}]).length,1);
});
