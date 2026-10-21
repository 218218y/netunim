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
    // Reviewed backup separation: the existing backup owner now maintains the
    // optional catalog outside Main hydration. Preserve all other policy tokens.
    if(app==='kupa'&&name==='applyCloudRow')actual=actual.replace('observeOptionalTask(()=>backupSnapshotToComputer(structuredClone(model.state),revision));',"try{session.serverInfo.backups=await listBackups();await backupSnapshotToComputer(model.state,revision)}catch(error){console.error('post-hydration local backup',error)}");
    // Reviewed admission change: a failed optimistic draft cannot be sent or
    // replaced. Fault/ACK/reload tests cover these guards; all other CAS,
    // normalization, monetary, authority and retry decisions remain frozen.
    if(name==='runStorageV2CloudSave'){
      const guard=app==='orders'?"if(hasFailedLocalMutation(session)){setCloud('ענן: שינוי לא נשמר מקומית','error');return false}":"if(hasFailedLocalMutation(session)){setSaveStatus('שינוי לא נשמר — ייצא JSON לפני סגירת החלון','error');return false}";
      assert.ok(actual.includes(guard));actual=actual.replace(guard,'').replace('&&!hasFailedLocalMutation(session)','');
    }
    if(name==='adoptRemoteRow'||name==='applyCloudRow'){
      const guard=name==='adoptRemoteRow'?'if(hasFailedLocalMutation(session))return false;':"if(hasFailedLocalMutation(session))throw new Error('storage_uncommitted_mutation');";
      assert.ok(actual.includes(guard));actual=actual.replace(guard,'').replace('return!hasFailedLocalMutation(session)&&','return ').replace('!hasFailedLocalMutation(session)&&','');
    }
    // Reviewed audit change: persist bounded backoff for transient errors with
    // no Retry-After. Preserve every other historical save-policy token.
    const reviewed=name==='runStorageV2CloudSave'?expected.replace('const normalized=normalizeCloudError(error),attempts=Number(state?.control?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null,retry={attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt};','const retry=createCloudRetryControl(error,state?.control?.retry);'):expected;
    assert.equal(actual,reviewed);
  });
}
