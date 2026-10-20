import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';

// Captured before changing composition from main revision 04167250. Do not
// regenerate to accommodate a refactor: a changed decision requires review.
const baseline=JSON.parse(readFileSync(new URL('./fixtures/main-sync-policies.json',import.meta.url),'utf8'));
for(const [app,policies] of Object.entries(baseline.policies)){
  const sources=['save-operation.js','remote-adoption.js','document.js'].map(file=>readFileSync(new URL(`../netunim-${app}/site/assets/js/sync/${file}`,import.meta.url),'utf8'));
  for(const [name,expected] of Object.entries(policies))test(`${app} Main ${name} retains the pre-composition policy`,()=>{
    const actualSource=name==='rpcSaveCloudV2'?readFileSync(new URL('../netunim-kupa/site/assets/js/cloud/main-document-write.js',import.meta.url),'utf8'):sources.find(source=>{try{declaration(source,name);return true}catch{return false}});
    const node=declaration(actualSource,name);
    let actual=tokens(actualSource.slice(node.start,node.end));
    // Only owner/port substitutions: the immutable policy fixture is retained.
    actual=actual.replaceAll('isOnline()','navigator.onLine').replaceAll('saveOperation.isSaving()','cloudSavePromise').replaceAll('saveOperation.joinFlight()','cloudSavePromise').replaceAll('saveOperation.runtime.','saveWork.').replaceAll('saveOperation.cancelRetry()','outboxRetryScheduler.cancel()').replaceAll('saveOperation.drainFollowup()','followup.drain()');
    if(app==='kupa')actual=actual.replace('void wake()','void polling.wake()').replace('markCloudMode();',"localStorage.setItem(STORAGE_PREF_KEY,'supabase');localStorage.setItem(SUPA_AUTO_KEY,'1');");
    if(name==='rpcSaveCloudV2')actual=actual.replace("request('/rest/v1/rpc/'+rpc", "supaRest('/rest/v1/rpc/'+rpc").replace('documentName()', 'session.cloudDocumentName').replace('validate(snapshot,','assertValidCloudState(snapshot,');
    // Reviewed audit change: persist bounded backoff for transient errors with
    // no Retry-After. Preserve every other historical save-policy token.
    const reviewed=name==='runStorageV2CloudSave'?expected.replace('const normalized=normalizeCloudError(error),attempts=Number(state?.control?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null,retry={attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt};','const retry=createCloudRetryControl(error,state?.control?.retry);'):expected;
    assert.equal(actual,reviewed);
  });
}
