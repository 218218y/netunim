import {assertSpreadsheet} from './spreadsheet-model.js';
import {equalSyncJson} from './cloud-sync.js';

export {sampleJournalIncident} from './sync-journal-incident.js';

export async function sampleSpreadsheetIncident({account,domain,primary,store,capture}){
  const scopedOwner=account(),scopedKey=scopedOwner+':'+domain+':main';
  if(scopedOwner==='local')return {known:false};
  try{
    const initial=capture(),live=!!initial.record&&initial.key===scopedKey;
    const saved=await store.load(scopedKey),emergency=store.inspectEmergency(scopedKey),value=live?initial.record:saved.record;
    if(!value)return {known:false};
    const state=capture(),working=live?state.working:value.working;
    const isCurrent=()=>{const latest=capture();return account()===scopedOwner&&primary()&&latest.record===initial.record&&latest.generation===initial.generation&&!latest.loading&&!latest.sending&&(!live||!latest.dirty&&!latest.localCommitError)};
    // Memory fencing alone cannot certify a closed sheet. Confirm again inside
    // the actual network slot, with both IDB stores locked for a fresh read.
    const durableCurrent=latest=>isCurrent()&&equalSyncJson(saved,latest)&&equalSyncJson(emergency,store.inspectEmergency(scopedKey));
    assertSpreadsheet(value.base);assertSpreadsheet(working);
    const pending=!!(value.flight||value.legacy||value.legacyRecovery||value.needsLegacyCheck||saved.drafts.length||emergency.length||!equalSyncJson(value.base,working)||live&&(state.dirty||state.generation>state.committedGeneration));
    return {known:true,pending,blocked:!!value.conflict,conflict:!!value.conflict,
      durabilityError:live&&state.localCommitError,epoch:value.monitorEpoch||'spreadsheet-v1',evidence:'spreadsheet',errorCode:'',
      verified:!pending&&!value.conflict&&Number.isSafeInteger(value.revision)&&(value.revision>0||value.revision===0&&value.syncIncidentVerified===true)&&(!live||!state.localCommitError&&!state.loading&&!state.sending&&state.generation<=state.committedGeneration),
      isCurrent,
      confirmCurrent:()=>store.withSnapshot(scopedKey,durableCurrent),
      withRequestScope:send=>store.withSnapshot(scopedKey,latest=>{if(!durableCurrent(latest))throw new Error('sync_incident_observation_changed');return send()})};
  }catch{const state=capture();return {known:false,durabilityError:!!state.record&&state.key===scopedKey&&state.localCommitError,epoch:state.record?.monitorEpoch||'spreadsheet-v1',evidence:'unknown'}}
}
