import {clone} from '../core/values.js';
import {payloadFromState} from '../state/serialization.js';
import {todayISO} from '../core/dates.js';
import {normalizeSharedBankEvents,normalizeSharedChecks} from '../domains/checks/model.js';
import {createRestoreGroup,executeRestoreGroup,resumeRestoreGroup} from '../shared/restore-groups.js';

function restoreDeleteIntents(before,after){
  const out={};
  for(const key of ['credits','cash','rights','notes','expenses','cards']){
    const kept=new Set((after?.[key]||[]).map(row=>String(row?.id||'')));
    const ids=(before?.[key]||[]).map(row=>String(row?.id||'')).filter(id=>id&&!kept.has(id));if(ids.length)out[key]=ids;
  }
  for(const part of ['rows','columns']){
    const oldRows=before?.notesSheet?.[part]||[],newRows=after?.notesSheet?.[part]||[],kept=new Set(newRows.map(row=>String(row?.id||''))),ids=oldRows.map(row=>String(row?.id||'')).filter(id=>id&&!kept.has(id));
    if(ids.length)out[`notesSheet.${part}`]=ids;
  }
  return out;
}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiBackup({model,session,ui,files,checksSession,readJsonHandle,listBackups,createManualBackup,toast,renderSettings,stateFromPayload,persistImmediateBrowserSnapshot,persistSharedChecksBase,saveState,chooseFolder,prepareKupaCloudState,readSupabaseDocument,readSharedChecksDocument,getCloudPending,getSharedChecksPending,restoreGroupStore,stageRestoreGroup,applyRestoreGroup,listIncompleteRestoreGroups,loadSupaSession,render,confirmDialog}){
  async function manualBackup(){
    if(!session.backendReady)return toast('יש לפתוח קודם מקור נתונים');
    try{const payload=session.connectionMode==='supabase'?payloadFromState(clone(model.state),session.dbRevision):await readJsonHandle(files.dataFileHandle);if(files.backupsDirHandle){const name=await createManualBackup(payload);session.serverInfo.backups=await listBackups();toast('נוצר גיבוי: '+name);if(ui.currentPage==='settings')renderSettings()}else downloadJsonBackup()}catch(error){alert('יצירת הגיבוי נכשלה: '+error.message)}
  }

  function downloadJsonBackup(){const payload=payloadFromState(clone(model.state),session.dbRevision);downloadText(`kupa-backup_${todayISO()}.json`,JSON.stringify(payload,null,2),'application/json;charset=utf-8');toast('עותק גיבוי הורד')}

  async function applyCompletedGroupLocally(group,result={}){
    const previous=clone(model.state);model.state=clone(group.localTargetState||{...group.main.state,checks:group.checks?.state?.checks||group.beforeState?.local?.checks||[]});
    session.connectionMode='supabase';session.backendReady=true;session.dbRevision=Number(result.main_revision||session.dbRevision||group.main.baseRevision);session.lastSavedSnapshot=JSON.stringify(group.main.state);
    if(group.checks){checksSession.sharedChecksRevision=Number(result.checks_revision||checksSession.sharedChecksRevision||group.checks.baseRevision);checksSession.sharedChecksBase=clone(group.checks.state.checks);checksSession.sharedChecksBankEvents=clone(group.checks.state.bankEvents||[]);persistSharedChecksBase(checksSession.sharedChecksBase,checksSession.sharedChecksBankEvents)}
    if(!persistImmediateBrowserSnapshot(model.state,session.dbRevision)){model.state=previous;persistImmediateBrowserSnapshot(previous,session.dbRevision);throw new Error('שמירת המצב המקומי לאחר השחזור נכשלה; השחזור נשאר ניתן לחידוש')}
    render();return true;
  }

  async function resumeIncompleteRestore(){
    if(!navigator.onLine||!loadSupaSession())return false;
    const resumed=await resumeRestoreGroup({store:restoreGroupStore,stageRemote:stageRestoreGroup,applyRemote:applyRestoreGroup,onApplied:applyCompletedGroupLocally});
    if(resumed){toast('שחזור שנקטע הושלם בבטחה');return true}
    const serverGroups=await listIncompleteRestoreGroups();for(const row of serverGroups.filter(item=>item.app_site==='kupa'))await applyRestoreGroup(row.restore_group_id);
    return serverGroups.some(item=>item.app_site==='kupa');
  }

  function restoreBackup(file){
    if(!file)return;const reader=new FileReader();
    reader.onload=async()=>{
      try{
        const state=stateFromPayload(JSON.parse(reader.result)).state,currentState=clone(model.state),cloudActive=session.connectionMode==='supabase'&&session.backendReady;
        if(!await confirmDialog('שחזור גיבוי','להחליף את הנתונים הנוכחיים בנתוני הגיבוי? לפני כל כתיבה יישמר צילום בטיחות durable. במצב ענן הקופה והצ׳קים ישוחזרו בפעולה מאוחדת אחת.',{confirmText:'שחזר גיבוי',cancelText:'ביטול',tone:'danger'}))return;
        if(files.backupsDirHandle)await createManualBackup(payloadFromState(currentState,session.dbRevision),'before-restore');
        let remoteRow=null,checksRow=null;
        if(cloudActive){
          if(!navigator.onLine)throw new Error('שחזור ענן דורש חיבור פעיל כדי לקבע את כל היעדים לפני הכתיבה');
          if(await getCloudPending()||await getSharedChecksPending())throw new Error('קיים שינוי מקומי שממתין לסנכרון; יש להשלים או לפתור אותו לפני שחזור');
          [remoteRow,checksRow]=await Promise.all([readSupabaseDocument(),readSharedChecksDocument()]);
          if(!remoteRow||!checksRow)throw new Error('לא ניתן לקבע את שני מסמכי הענן לפני השחזור');
        }
        const mainState=prepareKupaCloudState(state),checksState={version:1,checks:normalizeSharedChecks(state.checks),bankEvents:normalizeSharedBankEvents(checksRow?.state?.bankEvents||checksSession.sharedChecksBankEvents)};
        const checksBefore=checksRow?.state?.checks||currentState.checks||[],checksDeleteIds=checksBefore.map(row=>String(row.id)).filter(id=>!checksState.checks.some(row=>row.id===id));
        const group=await createRestoreGroup({
          appSite:'kupa',
          main:{documentName:session.cloudDocumentName||'main',baseRevision:Number(remoteRow?.revision||session.dbRevision||0),state:mainState,deleteIntents:restoreDeleteIntents(remoteRow?.state||currentState,mainState)},
          checks:{documentName:'main',baseRevision:Number(checksRow?.revision||checksSession.sharedChecksRevision||0),state:checksState,deleteIds:checksDeleteIds},
          beforeState:{local:currentState,main:clone(remoteRow?.state||prepareKupaCloudState(currentState)),checks:clone(checksRow?.state||{checks:currentState.checks||[],bankEvents:checksSession.sharedChecksBankEvents||[]})},
          localTargetState:state,
        });
        const applyLocal=cloudActive?applyCompletedGroupLocally:async(_group,result={})=>{
          const previous=clone(model.state);model.state=clone(state);
          try{await saveState('הגיבוי שוחזר',{deleteIntents:restoreDeleteIntents(currentState,state),mutationType:'restore',surface:'backup.restore'})}catch(error){model.state=previous;throw error}
          render();
        };
        if(cloudActive)await executeRestoreGroup(group,{store:restoreGroupStore,stageRemote:stageRestoreGroup,applyRemote:applyRestoreGroup,onApplied:applyLocal});
        else{const staged=await restoreGroupStore.stage(group);await applyLocal(staged,{});await restoreGroupStore.complete(staged)}
        toast('השחזור הושלם ונשמר כפעולה מאוחדת');
      }catch(error){console.error('restore backup',error);alert('השחזור נעצר בבטחה: '+(error.message||'קובץ הגיבוי אינו תקין'))}
    };
    reader.readAsText(file,'utf-8');
  }

  async function switchFolder(){if(!await confirmDialog('מעבר לתיקיית קופה אחרת','השינויים הנוכחיים כבר נשמרו בקובץ המחובר. לעבור לתיקייה אחרת?',{confirmText:'עבור תיקייה',cancelText:'ביטול',tone:'primary'}))return;await chooseFolder()}

  function exportCSV(kind){let rows;if(kind==='checks')rows=[['שם','סיווג','סכום','תאריך פירעון','סטטוס','תאריך הפקדה','מספר צק','הערה'],...model.state.checks.map(row=>[row.name,row.account==='ביתי'?'ביתי':'עסקי',row.amount,row.dueDate,row.status,row.depositDate||'',row.checkNumber||'',row.note||''])];else rows=[['כרטיס','חשבון','תיאור','סכום כולל','תשלומים','חיוב ראשון','פעיל','הערה'],...model.state.credits.map(row=>[row.card,row.account,row.description,row.totalAmount,row.installments,row.firstChargeDate,row.active?'כן':'לא',row.note||''])];const csv='\ufeff'+rows.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');downloadText(`${kind==='checks'?'checks':'credits'}_${todayISO()}.csv`,csv,'text/csv;charset=utf-8')}

  function downloadText(name,text,type){const blob=new Blob([text],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

  return {manualBackup,downloadJsonBackup,restoreBackup,resumeIncompleteRestore,switchFolder,exportCSV,downloadText};
}
