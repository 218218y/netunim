import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('actual Credit HTTP receipt and error bodies reject fabricated status and failure metadata',()=>{
  const file=path.join(root,'netunim-kupa/bank-bridge/credit-http-policy.mjs');
  const original=readFileSync(file,'utf8');
  for(const [from,to] of [
    ['return {status,body,retryAfter};','return {status:String(status),body,retryAfter};'],
    ['{stage,httpStatus:0}',"{stage,httpStatus:'confirmed'}"],
  ]){
    const changed=original.replace(from,to);assert.notEqual(changed,original);
    const diagnostics=check(new Map([[file,changed]]));
    assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===file&&[2322,2345].includes(item.code)),describe(diagnostics));
  }
});
