import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';
import {originalMorningApplicationPolicy} from './morning_application_policy_fixture.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/morning-media-preserved-policy.json',import.meta.url),'utf8'));
for(const [file,functions] of Object.entries(baseline.files)){
  const source=readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/'+file+'.js',import.meta.url),'utf8');
  for(const [name,expected] of Object.entries(functions))test(`Morning ${name} preserves pre-media issuance/debt/search policy`,()=>{
    const expanded=name==='applyVerifiedContextOnce'?originalMorningApplicationPolicy(readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/morning-debt-application.js',import.meta.url),'utf8')):null;
    const node=expanded?null:declaration(source,name),actual=createHash('sha256').update(expanded||tokens(source.slice(node.start,node.end))).digest('hex');
    assert.equal(actual,expected,`business policy drift from ${baseline.commit}`);
  });
}
test('the PDF owner has five ports and cannot perform debt allocation or document issuance',()=>{
  const source=readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/morning-document-media.js',import.meta.url),'utf8');
  assert.equal(declaration(source,'createMorningDocumentMedia').params[0].properties.length,5);
  for(const name of ['applyVerifiedDebtDocument','customerDebts',"json('create'","json('reserve'",'localStorage'])assert.equal(source.includes(name),false);
});
test('the debt application owner has five ports and no raw model, transport or persistence',()=>{
  const source=readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/morning-debt-application.js',import.meta.url),'utf8');
  assert.equal(declaration(source,'createMorningDebtApplication').params[0].properties.length,5);
  for(const name of ['customerDebts','localStorage','document.','supaFetch','request.json','commitSave','setTimeout'])assert.equal(source.includes(name),false);
});
