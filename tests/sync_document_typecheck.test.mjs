import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {root,check,describe} from './typecheck_contract_fixture.mjs';
for(const app of ['orders','kupa'])for(const[label,change]of [
  ['raw RPC row as ACK',source=>source.replace(/readDocumentWriteAck\(res\.row,\{[^\n]+?\}\)/,'res.row')],
  ['asynchronous publication',source=>source.replace('publish:()=>','publish:async()=>')],
  ['cloud ACK instead of local checkpoint',source=>source.replace('committed:/** @type {const} */(true),state:committedState','committed:/** @type {const} */(true),state:res.row')],
])test(app+' actual ACK coordinator rejects '+label,()=>{
  const file=path.join(root,`netunim-${app}/site/assets/js/sync/ack-publication.js`),original=readFileSync(file,'utf8'),changed=change(original);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[file,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===file&&[2322,2339,2345].includes(item.code)),describe(diagnostics));
});
