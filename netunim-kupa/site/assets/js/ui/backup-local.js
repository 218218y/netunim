import {payloadFromState} from '../state/serialization.js';
import {clone} from '../core/values.js';
import {todayISO} from '../core/dates.js';

// Owns local import/export through explicit ports.
export function createBackupLocal({model,session,ui,files,projection={},view={},local={},restore,browser}){
  const downloadText=(name,text,type,scope)=>browser.download(new Blob([text],{type}),name,scope);
  const {stateFromPayload}=projection;
  const {toast,renderSettings,confirmDialog}=view;
  const {readJsonHandle,listBackups,createManualBackup,chooseFolder}=local;
  const {restoreState}=restore;

async function manualBackup(){
    if(!session.backendReady)return toast('יש לפתוח קודם מקור נתונים');
    try{const payload=session.connectionMode==='supabase'?payloadFromState(clone(model.state),session.dbRevision):await readJsonHandle(files.dataFileHandle);if(files.backupsDirHandle){const name=await createManualBackup(payload);session.serverInfo.backups=await listBackups();toast('נוצר גיבוי: '+name);if(ui.currentPage==='settings')renderSettings()}else downloadJsonBackup()}catch(error){alert('יצירת הגיבוי נכשלה: '+error.message)}
  }

function downloadJsonBackup(){const payload=payloadFromState(clone(model.state),session.dbRevision);downloadText(`kupa-backup_${todayISO()}.json`,JSON.stringify(payload,null,2),'application/json;charset=utf-8');toast('עותק גיבוי הורד')}

async function restoreFromText(raw,_file,scope){
  const state=stateFromPayload(JSON.parse(raw)).state;scope.assertCurrent();
  return await restoreState(state,{assertFileCurrent:scope.assertCurrent,signal:scope.signal});
}
function restoreFailure(error){
  if(error?.code==='backup_file_scope_changed')return false;
  console.error('restore backup',error);alert('השחזור נעצר בבטחה: '+(error.message||'קובץ הגיבוי אינו תקין'));return false;
}
async function beginRestoreBackup(){
  try{return await browser.choose(restoreFromText)}catch(error){return restoreFailure(error)}
}
async function restoreBackup(file){
  if(!file)return false;
  try{return await browser.read(file,restoreFromText)}catch(error){return restoreFailure(error)}
}

async function switchFolder(){if(!await confirmDialog('מעבר לתיקיית קופה אחרת','השינויים הנוכחיים כבר נשמרו בקובץ המחובר. לעבור לתיקייה אחרת?',{confirmText:'עבור תיקייה',cancelText:'ביטול',tone:'primary'}))return;await chooseFolder()}

function exportCSV(kind){let rows;if(kind==='checks')rows=[['שם','סיווג','סכום','תאריך פירעון','סטטוס','תאריך הפקדה','מספר צק','הערה'],...model.state.checks.map(row=>[row.name,row.account==='ביתי'?'ביתי':'עסקי',row.amount,row.dueDate,row.status,row.depositDate||'',row.checkNumber||'',row.note||''])];else rows=[['כרטיס','חשבון','תיאור','סכום כולל','תשלומים','חיוב ראשון','פעיל','הערה'],...model.state.credits.map(row=>[row.card,row.account,row.description,row.totalAmount,row.installments,row.firstChargeDate,row.active?'כן':'לא',row.note||''])];const csv='\ufeff'+rows.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');downloadText(`${kind==='checks'?'checks':'credits'}_${todayISO()}.csv`,csv,'text/csv;charset=utf-8')}

return {manualBackup,downloadJsonBackup,beginRestoreBackup,restoreBackup,switchFolder,exportCSV};
}
