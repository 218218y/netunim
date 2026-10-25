import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('the actual automatic Finance owner rejects deferred authority and fabricated timer handles',()=>{
  const source=path.join(root,'netunim-orders/site/assets/js/domains/finance/automation.js');
  const original=readFileSync(source,'utf8');
  for(const [from,to] of [['guard=access.capture()','guard=async()=>undefined'],['handles[kind]=handle',"handles[kind]='timer'"]]){
    const changed=original.replace(from,to);assert.notEqual(changed,original);
    const diagnostics=check(new Map([[source,changed]]));
    assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
  }
});
