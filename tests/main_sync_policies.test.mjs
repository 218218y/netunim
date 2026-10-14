import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';

// Captured before changing composition from main revision 04167250. Do not
// regenerate to accommodate a refactor: a changed decision requires review.
const baseline=JSON.parse(readFileSync(new URL('./fixtures/main-sync-policies.json',import.meta.url),'utf8'));
for(const [app,policies] of Object.entries(baseline.policies)){
  const source=readFileSync(new URL(`../netunim-${app}/site/assets/js/sync/document.js`,import.meta.url),'utf8');
  for(const [name,expected] of Object.entries(policies))test(`${app} Main ${name} retains the pre-composition policy`,()=>{
    const actualSource=name==='rpcSaveCloudV2'?readFileSync(new URL('../netunim-kupa/site/assets/js/cloud/main-document-write.js',import.meta.url),'utf8'):source;
    const node=declaration(actualSource,name);
    let actual=tokens(actualSource.slice(node.start,node.end));
    if(name==='rpcSaveCloudV2')actual=actual.replace("request('/rest/v1/rpc/'+rpc", "supaRest('/rest/v1/rpc/'+rpc").replace('documentName()', 'session.cloudDocumentName').replace('validate(snapshot,','assertValidCloudState(snapshot,');
    assert.equal(actual,expected);
  });
}
