import {journalIncidentSample} from './sync-incident-model.js';
import {assertSpreadsheet} from './spreadsheet-model.js';
import {equalSyncJson} from './cloud-sync.js';

// Loaded by observers, outside the business journal's startup dependency graph.
export async function sampleJournalIncident({read,ready,current,epoch,durabilityError,blocked,fatal}){
  const unavailable=error=>({known:false,blocked:blocked()||ready()&&!!error&&fatal(error)==='fatal',durabilityError:durabilityError(),epoch:epoch()||'unavailable',evidence:'unknown'});
  if(!ready())return unavailable();
  try{
    const cloud=await read();
    if(!ready())return unavailable();
    return journalIncidentSample(cloud,{durabilityError:durabilityError(),current:()=>ready()&&current(cloud)});
  }catch(error){return unavailable(error)}
}

export async function sampleSpreadsheetIncident({account,domain,primary,store,capture}){
  const scopedOwner=account(),scopedKey=scopedOwner+':'+domain+':main';
  if(scopedOwner==='local')return {known:false};
  try{
    const initial=capture(),live=!!initial.record&&initial.key===scopedKey;
    const saved=await store.load(scopedKey),emergency=store.inspectEmergency(scopedKey),value=live?initial.record:saved.record;
    if(!value)return {known:false};
    const state=capture(),working=live?state.working:value.working;
    assertSpreadsheet(value.base);assertSpreadsheet(working);
    const pending=!!(value.flight||value.legacy||value.legacyRecovery||value.needsLegacyCheck||saved.drafts.length||emergency.length||!equalSyncJson(value.base,working)||live&&(state.dirty||state.generation>state.committedGeneration));
    return {known:true,pending,blocked:!!value.conflict,conflict:!!value.conflict,
      durabilityError:live&&state.localCommitError,epoch:value.monitorEpoch||'spreadsheet-v1',evidence:'spreadsheet',errorCode:'',
      verified:!pending&&!value.conflict&&Number.isSafeInteger(value.revision)&&(value.revision>0||value.revision===0&&value.syncIncidentVerified===true)&&(!live||!state.localCommitError&&!state.loading&&!state.sending&&state.generation<=state.committedGeneration),
      isCurrent:()=>{const latest=capture();return account()===scopedOwner&&primary()&&latest.record===initial.record&&latest.generation===initial.generation&&!latest.loading&&!latest.sending&&(!live||!latest.dirty&&!latest.localCommitError)}};
  }catch{const state=capture();return {known:false,durabilityError:!!state.record&&state.key===scopedKey&&state.localCommitError,epoch:state.record?.monitorEpoch||'spreadsheet-v1',evidence:'unknown'}}
}
