import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('transport implementation baseline includes unknown wire and negative consumers',()=>{
  const diagnostics=check();assert.equal(diagnostics.length,0,describe(diagnostics));
});
for(const [app,from,to] of [
  ['orders','const row=readCloudDocumentRows(j,CLOUD_DOC);','const row=j;'],
  ['kupa','return readBankSnapshotReceipt(j);','return j;'],
  ['orders','return readRestoreApplyReceipt(',"return 'applied';return readRestoreApplyReceipt("],
  ['kupa','return readFinanceDocumentRows(j,FINANCE_DOC);','return j;'],
])test(app+' actual transport cannot substitute raw wire/display text for '+from,()=>{
  const source=path.join(root,`netunim-${app}/site/assets/js/cloud/transport.js`),original=readFileSync(source,'utf8'),changed=original.replace(from,to);
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2339,18046].includes(item.code)),describe(diagnostics));
});
