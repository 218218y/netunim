import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tokens} from './bank_policy_ast_fixture.mjs';
import {baseline,semanticPolicy} from './calendar_projection_policy_fixture.mjs';
const root=new URL('../netunim-orders/site/assets/js/domains/calendar/',import.meta.url);
const sources=['read-model.js','presentation.js','editor-payload.js','controller.js'].filter(file=>existsSync(new URL(file,root))).map(file=>readFileSync(new URL(file,root),'utf8'));
for(const [name,expected]of Object.entries(baseline.functions))test(`Calendar projection/editor ${name} preserves the recorded policy`,()=>{
 const source=sources.find(value=>value.includes('function '+name+'('));assert.ok(source,name);
 assert.equal(createHash('sha256').update(tokens(expected.source)).digest('hex'),expected.digest);
 assert.deepEqual(semanticPolicy(source,name),semanticPolicy(expected.source,name),'policy drift from '+baseline.commit);
});
test('immutable display policies detect removal of readonly and pending-delete protection',()=>{
 for(const [name,from,to]of [['editableEvent',"event.visibility==='private'","event.visibility==='public'"],['applyPending','_pendingDelete:true','_pendingDelete:false']]){
  const original=baseline.functions[name].source,changed=original.replace(from,to);assert.notEqual(changed,original);
  assert.notDeepEqual(semanticPolicy(changed,name),semanticPolicy(original,name));
 }
});
