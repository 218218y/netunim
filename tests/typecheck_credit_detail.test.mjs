import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('both actual credit detail read models reject fabricated count and total types',()=>{
  for(const [file,from,to] of [
    ['netunim-kupa/site/assets/js/domains/credit/detail-read-model.js','focusedCount:focusedItems.length','focusedCount:String(focusedItems.length)'],
    ['netunim-orders/site/assets/js/domains/finance/credit-detail-read-model.js','focusedCount:focusedRows.length','focusedCount:String(focusedRows.length)'],
  ]){
    const source=path.join(root,file),original=readFileSync(source,'utf8'),changed=original.replaceAll(from,to);
    assert.notEqual(changed,original);
    const diagnostics=check(new Map([[source,changed]]));
    assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
  }
});
