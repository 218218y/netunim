import {assertSpreadsheet,migrateLegacySpreadsheet,mergeSpreadsheets,spreadsheetDeleteIntents} from './spreadsheet-model.js';
import {createDefaultNotesSheet,notesSheetHasMeaningfulData} from './notes-sheet-model.js';
import {createOperationId,equalSyncJson} from './cloud-sync.js';
import {createSpreadsheetStore} from './spreadsheet-store.js';

export const SPREADSHEET_IDLE_MS=1800;
export const SPREADSHEET_DRAFT_MS=120;

export function createSpreadsheetSync({domain,request,account,enabled,primary=()=>true,online=()=>globalThis.navigator?.onLine!==false,store=createSpreadsheetStore(),onChange=()=>{},onStatus=()=>{},legacy=()=>undefined,setTimer=setTimeout,clearTimer=clearTimeout}){
  const model={state:{notesSheet:null}};
  let key='',owner='',record=null,loading=null,sending=null,writeQueue=Promise.resolve(),draftTimer=null,idleTimer=null,retryTimer=null,dirty=false,generation=0;
  const patches=new Map();
  const metrics={rpc:0,sentBytes:0,reads:0,localCommits:0,journals:0};
  let status='unloaded',error='';
  const currentAccount=()=>String(account?.()||'local');
  function setStatus(next,message=''){status=next;error=message;onStatus({status,error,revision:record?.revision||0})}
  function available(){return owner===currentAccount()&&primary()}
  function cloud(){return available()&&enabled()&&owner!=='local'&&online()}
  function queue(operation){const result=writeQueue.then(operation);writeQueue=result.catch(e=>{setStatus('error',e.message)});return result}
  function snapshotRecord(){return {...record,working:structuredClone(model.state.notesSheet),generation}}
  async function commit(){const value=snapshotRecord(),at=generation;await queue(()=>store.commit(key,value));metrics.localCommits++;if(generation===at){patches.clear();store.saveEmergency(key,[])}return value}
  async function api(path,options={}){
    if(!available())throw new Error('חשבון הגליון השתנה. פתח מחדש את הגליון.');
    const response=await request(path,{...options,networkRetry:true,dataPriority:'normal'}),body=await response.text();let data;try{data=body?JSON.parse(body):null}catch{data=null}
    if(!response.ok){const e=new Error(data?.message||'סנכרון הגליון נכשל');e.code=data?.code;e.status=response.status;throw e}
    return Array.isArray(data)?data[0]:data;
  }
  async function readRemote(metadata=false){metrics.reads++;return api(`/rest/v1/spreadsheet_documents?domain=eq.${domain}&document_name=eq.main&select=${metadata?'revision':'revision,state,updated_at'}`)}
  function applyPatches(items){
    const rows=new Map(model.state.notesSheet.rows.map(row=>[row.id,row])),columns=new Map(model.state.notesSheet.columns.map(column=>[column.id,column]));
    for(const patch of items){const row=rows.get(patch.rowId),column=columns.get(patch.columnId);if(!row||column?.sheetId!==row.sheetId||typeof patch.value!=='string')throw new Error('טיוטת הגליון אינה מתאימה לנתונים. נדרשת התאוששות.');row.cells[column.id]=patch.value;row.updatedAt=patch.updatedAt;generation=Math.max(generation,Number(patch.generation||0));dirty=true}
  }
  async function open(){
    if(loading)return loading;
    if(record&&owner===currentAccount()&&status!=='error')return true;
    if(sending)await sending;
    await writeQueue;clearTimer(idleTimer);clearTimer(draftTimer);clearTimer(retryTimer);patches.clear();dirty=false;generation=0;
    owner=currentAccount();key=owner+':'+domain+':main';setStatus('loading');
    loading=(async()=>{
      const saved=await store.load(key);record=saved.record;
      if(record){assertSpreadsheet(record.base);assertSpreadsheet(record.working);model.state.notesSheet=record.legacy?migrateLegacySpreadsheet(record.legacy):structuredClone(record.working);generation=Number(record.generation||0);dirty=!!record.flight||!equalSyncJson(record.base,record.working);applyPatches([...saved.drafts,...store.readEmergency(key)])}
      else{
        const original=legacy(),base=createDefaultNotesSheet();
        // A legacy local copy is kept separately until compared to its cloud migration.
        const legacyCopy=original?migrateLegacySpreadsheet(original):null;
        record={version:1,revision:0,base,working:base,generation:0,flight:null,conflict:null,legacy:legacyCopy};model.state.notesSheet=base;
      }
      if(cloud())try{await reconcileRemote()}catch(e){if(e.status||!saved.record)throw e;setStatus('offline',e.message)}
      else if(record.legacy){model.state.notesSheet=migrateLegacySpreadsheet(record.legacy);record.base=structuredClone(model.state.notesSheet);record.needsLegacyCheck=true;applyPatches([...saved.drafts,...store.readEmergency(key)])}
      await commit();setStatus(record.conflict?'conflict':dirty?'pending':cloud()?'saved':'offline');onChange();
      if(dirty&&cloud())scheduleCloud();return true;
    })().catch(e=>{setStatus('error',e.message);onChange();return false}).finally(()=>{loading=null});
    return loading;
  }
  async function reconcileRemote(){
    // A possibly accepted flight must be replayed before changing its lineage.
    if(record.flight){await sendFlight();return}
    const remote=await readRemote();if(!remote)return;
    assertSpreadsheet(remote.state);
    if(record.legacy||record.needsLegacyCheck){
      const original=migrateLegacySpreadsheet(record.legacy||record.base);
      if(record.legacyBase){const merged=mergeSpreadsheets(migrateLegacySpreadsheet(record.legacyBase),original,remote.state,record.legacyDeleteIntents||{});if(merged.conflicts.length){record.conflict={items:merged.conflicts,remote};model.state.notesSheet=original;dirty=true;return}model.state.notesSheet=merged.state;record.base=remote.state;dirty=!equalSyncJson(merged.state,remote.state);delete record.legacyBase;delete record.legacyDeleteIntents}
      else if(!equalSyncJson(original,remote.state)&&notesSheetHasMeaningfulData(original)){record.conflict={reason:'legacy-local-difference',remote};model.state.notesSheet=structuredClone(original);dirty=true;return}
      delete record.legacy;delete record.needsLegacyCheck;
    }
    if(dirty){const merged=mergeSpreadsheets(record.base,model.state.notesSheet,remote.state,spreadsheetDeleteIntents(record.base,model.state.notesSheet));if(merged.conflicts.length){record.conflict={items:merged.conflicts,remote};return}model.state.notesSheet=merged.state}
    else model.state.notesSheet=structuredClone(remote.state);
    record.base=structuredClone(remote.state);record.revision=remote.revision;dirty=!equalSyncJson(record.base,model.state.notesSheet);
  }
  function scheduleCloud(){clearTimer(idleTimer);idleTimer=setTimer(()=>{idleTimer=null;void flush().catch(()=>{})},SPREADSHEET_IDLE_MS)}
  function changed(patch=null,{immediate=false}={}){
    if(!record||!available()||record.conflict||status==='error')return false;
    generation++;dirty=true;record.generation=generation;
    if(patch){const value={...patch,generation};patches.set(patch.rowId+'\u0000'+patch.columnId,value);if(!draftTimer)draftTimer=setTimer(()=>{draftTimer=null;void persistDrafts().catch(()=>{})},SPREADSHEET_DRAFT_MS)}
    setStatus('pending');
    if(immediate){void flush().catch(()=>{})}else scheduleCloud();return true;
  }
  async function persistDrafts(){
    if(!patches.size)return;
    const values=[...patches.values()];await queue(()=>store.journal(key,values));metrics.journals++;
  }
  async function sendFlight(){
    const flight=record.flight;if(!flight||!cloud())return;
    setStatus('saving');metrics.rpc++;metrics.sentBytes+=new TextEncoder().encode(JSON.stringify(flight.payload)).length;
    let result;
    try{result=await api('/rest/v1/rpc/'+(flight.restore?'restore_spreadsheet_document_v1':'save_spreadsheet_document_v1'),{method:'POST',body:JSON.stringify(flight.payload)})}
    catch(e){
      if(e.code==='40001'||e.status===409){
        const remote=await readRemote();assertSpreadsheet(remote.state);
        if(flight.restore){record.flight=null;record.conflict={reason:'restore-revision-changed',remote};await commit();setStatus('conflict');return}
        const merged=mergeSpreadsheets(record.base,model.state.notesSheet,remote.state,spreadsheetDeleteIntents(record.base,model.state.notesSheet));
        record.flight=null;if(merged.conflicts.length){record.conflict={items:merged.conflicts,remote};await commit();setStatus('conflict');return}
        model.state.notesSheet=merged.state;record.base=remote.state;record.revision=remote.revision;dirty=!equalSyncJson(record.base,model.state.notesSheet);await commit();return;
      }
      throw e;
    }
    if(!available())throw new Error('החשבון השתנה במהלך שמירת הגליון');
    assertSpreadsheet(result.state);
    const merged=mergeSpreadsheets(flight.state,model.state.notesSheet,result.state,spreadsheetDeleteIntents(flight.state,model.state.notesSheet));
    record.flight=null;
    if(merged.conflicts.length)record.conflict={items:merged.conflicts,remote:result};
    else model.state.notesSheet=merged.state;
    record.base=structuredClone(result.state);record.revision=result.revision;dirty=!!record.conflict||!equalSyncJson(record.base,model.state.notesSheet);await commit();
  }
  async function flush({send=true}={}){
    if(!record||!available())return false;
    clearTimer(draftTimer);draftTimer=null;clearTimer(idleTimer);idleTimer=null;
    try{assertSpreadsheet(model.state.notesSheet);await commit()}catch(e){setStatus('error',e.message);onChange();return false}
    if(!send||!cloud()||record.conflict){setStatus(record.conflict?'conflict':dirty?'offline':'saved');return !dirty}
    if(sending)return sending;
    sending=(async()=>{
      for(let attempt=0;attempt<3;attempt++){
        if(record.conflict||!cloud())break;
        if(!record.flight){
          if(!dirty)break;
          const state=structuredClone(model.state.notesSheet),intents=spreadsheetDeleteIntents(record.base,state),operationId=createOperationId('sheet');
          record.flight={state,payload:{p_domain:domain,p_document_name:'main',p_expected_revision:record.revision,p_state:state,p_operation_id:operationId,p_delete_intents:intents,p_kind:Object.values(intents).reduce((sum,ids)=>sum+ids.length,0)>20?'bulk-delete':Object.keys(intents).length?'delete':'edit'}};
          await commit();
        }
        await sendFlight();
        // Coalesce edits typed during the request into the next idle window.
        if(dirty&&!record.conflict){scheduleCloud();break}
      }
      setStatus(record.conflict?'conflict':dirty?'pending':'saved');onChange();return !dirty;
    })().catch(e=>{setStatus('pending',e.message);clearTimer(retryTimer);retryTimer=setTimer(()=>{retryTimer=null;if(cloud())void flush().catch(()=>{})},15000);return false}).finally(()=>{sending=null});return sending;
  }
  async function poll(){if(!record||!cloud()||sending||loading||record.conflict)return false;if(dirty)return flush();const metadata=await readRemote(true);if(metadata&&Number(metadata.revision)>record.revision){await reconcileRemote();await commit();setStatus(record.conflict?'conflict':'saved');onChange();return true}return false}
  function pagehide(){if(!record||!available())return;store.saveEmergency(key,[...patches.values()]);void persistDrafts().catch(()=>{})}
  async function backups(){if(!record||!cloud())return [];const response=await request(`/rest/v1/spreadsheet_backups?domain=eq.${domain}&document_name=eq.main&select=id,revision,created_at,kind&order=created_at.desc&limit=40`,{method:'GET'});if(!response.ok)throw new Error('לא ניתן לקרוא את גיבויי הגליון');return response.json()}
  async function restore(id){
    if(!cloud()||record.conflict)throw new Error('נדרש חיבור תקין לענן לפני שחזור');
    await flush();if(dirty)throw new Error('יש לשמור את השינויים המקומיים לפני שחזור');
    record.flight={restore:true,state:structuredClone(model.state.notesSheet),payload:{p_domain:domain,p_document_name:'main',p_expected_revision:record.revision,p_backup_id:id,p_operation_id:createOperationId('sheet-restore')}};dirty=true;
    await commit();const saved=await flush();if(!saved)throw new Error(record.conflict?'גרסת הענן השתנתה. השחזור נעצר לבדיקת השינויים.':'השחזור ממתין לאישור הענן וינוסה שוב בבטחה.');return true;
  }
  async function useRemoteAfterExport(){if(!record?.conflict?.remote)throw new Error('אין גרסת ענן זמינה');const remote=record.conflict.remote;assertSpreadsheet(remote.state);model.state.notesSheet=structuredClone(remote.state);record={version:1,revision:remote.revision,base:structuredClone(remote.state),flight:null,conflict:null,generation:++generation};dirty=false;await commit();setStatus('saved');onChange()}
  async function captureLegacy(source,baseSource=null,deleteIntents={}){if(!source)return;const copy=structuredClone(source),legacyKey=currentAccount()+':'+domain+':main',saved=await store.load(legacyKey);if(saved.record&&!baseSource)return;const base=createDefaultNotesSheet(),value=saved.record||{version:1,revision:0,base,working:base,generation:0,flight:null,conflict:null};value.legacy=copy;if(baseSource){value.legacyBase=structuredClone(baseSource);value.legacyDeleteIntents=structuredClone(deleteIntents)}await store.commit(legacyKey,value)}
  return {model,open,changed,flush,poll,pagehide,backups,restore,useRemoteAfterExport,captureLegacy,metrics,get status(){return status},get error(){return error},get revision(){return record?.revision||0},get ready(){return !!record&&owner===currentAccount()&&status!=='loading'&&status!=='error'},get conflict(){return record?.conflict||null}};
}
