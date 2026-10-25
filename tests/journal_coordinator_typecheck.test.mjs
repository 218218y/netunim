import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('actual Journal coordinator and negative consumers compile strictly',()=>{
  const diagnostics=check();assert.equal(diagnostics.length,0,describe(diagnostics));
});
for(const [from,to] of [
  ['emergencyDurable,transitionFallbackDurable:fallbackDurable,committed,transitioning:', 'emergencyDurable,transitionFallbackDurable:fallbackDurable,committed:true,transitioning:'],
  ['return {operationId:flightId,revision,ackSeq:flight.endSeq};', "return {operationId:flightId,revision,ackSeq:'1'};"],
  ['return {seq:operation.seq,operationId:', "return {seq:'1',operationId:"],
])test(`checked Journal coordinator rejects ${to}`,()=>{
  const target=path.join(root,'shared/storage-journal.js'),original=readFileSync(target,'utf8'),mutated=original.replace(from,to);
  assert.notEqual(original,mutated,from);
  const diagnostics=check(new Map([[target,mutated]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===target&&[2322,2345].includes(item.code)),describe(diagnostics));
});
