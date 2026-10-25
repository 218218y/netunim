import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';

// Captured before changing composition from main revision 04167250. Do not
// regenerate to accommodate a refactor: a changed decision requires review.
const baseline=JSON.parse(readFileSync(new URL('./fixtures/main-sync-policies.json',import.meta.url),'utf8'));
const typedPolicies=JSON.parse(readFileSync(new URL('./fixtures/typed-main-sync-policies.json',import.meta.url),'utf8'));
const digest=value=>createHash('sha256').update(value).digest('hex');
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
    // Reviewed safety repair: held head/HTTP/adoption regressions prove the
    // Morning path cannot borrow a replacement account, login or epoch.
    // Normalize only these additions; retain the historical policy comparison.
    if(app==='orders'&&name==='adoptRemoteRow'){
      assert.ok(actual.includes('if(!isCurrent()||hasFailedLocalMutation(session))return false;'));
      assert.ok(actual.includes('isCurrent:committed=>isCurrent()&&'));
      actual=actual.replace(',isCurrent=()=>true','').replace('if(!isCurrent()||hasFailedLocalMutation(session))','if(hasFailedLocalMutation(session))')
        .replace('isCurrent:committed=>isCurrent()&&','isCurrent:committed=>').replace('!publication.published&&isCurrent()&&','!publication.published&&');
    }
    if(app==='orders'&&name==='refreshForMorningRecovery'){
      assert.ok(actual.includes('const requestedScope=getCloudWriteScope();'));
      assert.ok(actual.includes('if(!current())return false;'));
      assert.ok(actual.includes('finally{if(cloudWriteScopeHasIdentity(requestedScope,getCloudWriteScope()))session.cloudBusy=false}'));
      actual=actual.replace('const requestedScope=getCloudWriteScope();','').replace('writeScopeCurrent(requestedScope)&&','')
        .replace('const head=await refreshStorageV2CloudState();const scope=captureCloudWriteScope(requestedScope,head),current=()=>available()&&writeScopeCurrent(scope,head);if(!current())return false;const generation=', 'const head=await refreshStorageV2CloudState(),generation=')
        .replace('adoptRemoteRow(row,generation,head,{isCurrent:current})||!current()','adoptRemoteRow(row,generation,head)')
        .replace('if(cloudWriteScopeHasIdentity(requestedScope,getCloudWriteScope()))session.cloudBusy=false','session.cloudBusy=false');
    }
    if(name==='adoptRemoteRow'||name==='applyCloudRow'){
      const guard=name==='adoptRemoteRow'?'if(hasFailedLocalMutation(session))return false;':"if(hasFailedLocalMutation(session))throw new Error('storage_uncommitted_mutation');";
      assert.ok(actual.includes(guard));actual=actual.replace(guard,'').replace('return!hasFailedLocalMutation(session)&&','return ').replace('!hasFailedLocalMutation(session)&&','');
    }
    // Reviewed audit change: persist bounded backoff for transient errors with
    // no Retry-After. Preserve every other historical save-policy token.
    const reviewed=name==='runStorageV2CloudSave'?expected.replace('const normalized=normalizeCloudError(error),attempts=Number(state?.control?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null,retry={attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt};','const retry=createCloudRetryControl(error,state?.control?.retry);'):expected;
    // Reviewed checked-body changes add shape/null guards, capture validated
    // revisions and fence poll publication. Freeze both sides separately;
    // the historical policy fixture is never regenerated to accept a change.
    const typed=typedPolicies.policies[app]?.[name];
    if(typed){assert.equal(digest(reviewed),typed.before);assert.equal(digest(actual),typed.after)}
    else assert.equal(actual,reviewed);
  });
}
