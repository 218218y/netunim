import {clone} from '../core/values.js';
import {payloadFromState} from '../state/serialization.js';
import {todayISO} from '../core/dates.js';


// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiBackup({model, session, ui, files, checksSession, readJsonHandle, listBackups, createManualBackup, toast, renderSettings, normalizeState, stateFromPayload, persistImmediateBrowserSnapshot, markSharedChecksPending, saveState, saveSharedChecksToCloud, chooseFolder, confirmDialog}){
async function manualBackup(){
  if(!session.backendReady)return toast('יש לפתוח קודם מקור נתונים');
  try{const p=session.connectionMode==='supabase'?payloadFromState(clone(model.state),session.dbRevision):await readJsonHandle(files.dataFileHandle);if(files.backupsDirHandle){const name=await createManualBackup(p);session.serverInfo.backups=await listBackups();toast('נוצר גיבוי: '+name);if(ui.currentPage==='settings')renderSettings()}else{downloadJsonBackup()}}catch(e){alert('יצירת הגיבוי נכשלה: '+e.message)}
}

function downloadJsonBackup(){const payload=payloadFromState(clone(model.state),session.dbRevision);downloadText(`kupa-backup_${todayISO()}.json`,JSON.stringify(payload,null,2),'application/json;charset=utf-8');toast('עותק גיבוי הורד')}


function restoreBackup(file){if(!file)return;const reader=new FileReader();reader.onload=async()=>{try{const p=JSON.parse(reader.result);const d=stateFromPayload(p).state,currentChecks=clone(model.state.checks||[]);if(!await confirmDialog('שחזור גיבוי','להחליף את הנתונים הנוכחיים בנתוני הגיבוי? לפני ההחלפה יישמר עותק בטיחות מקומי אם תיקיית גיבוי מחוברת. במצב ענן ישוחזרו גם נתוני הקופה וגם מאגר הצקים המשותף, כל אחד דרך Revision עצמאי.',{confirmText:'שחזר גיבוי',cancelText:'ביטול',tone:'danger'}))return;if(files.backupsDirHandle)await createManualBackup(payloadFromState(clone(model.state),session.dbRevision),'before-restore');model.state=d;if(session.connectionMode==='supabase'&&session.backendReady){await saveState('נתוני הקופה מהגיבוי שוחזרו');const restoredDeleteIds=currentChecks.map(x=>x.id).filter(id=>!model.state.checks.some(x=>x.id===id));checksSession.sharedChecksGeneration++;checksSession.sharedChecksSaveRequested=true;markSharedChecksPending(model.state.checks,undefined,undefined,{deleteIds:restoredDeleteIds});persistImmediateBrowserSnapshot(model.state,session.dbRevision);const checksOk=await saveSharedChecksToCloud('הצקים מהגיבוי שוחזרו');if(!checksOk)toast('נתוני הקופה שוחזרו; הצקים נשמרו מקומית וממתינים לסנכרון')}else await saveState('הגיבוי שוחזר')}catch(e){console.error(e);alert('השחזור נעצר: '+(e.message||'קובץ הגיבוי אינו תקין'))}};reader.readAsText(file,'utf-8')}

async function switchFolder(){if(!await confirmDialog('מעבר לתיקיית קופה אחרת','השינויים הנוכחיים כבר נשמרו בקובץ המחובר. לעבור לתיקייה אחרת?',{confirmText:'עבור תיקייה',cancelText:'ביטול',tone:'primary'}))return;await chooseFolder()}

function exportCSV(kind){let rows;if(kind==='checks')rows=[['שם','סכום','תאריך פירעון','סטטוס','תאריך הפקדה','מספר צק','הערה'],...model.state.checks.map(x=>[x.name,x.amount,x.dueDate,x.status,x.depositDate||'',x.checkNumber||'',x.note||''])];else rows=[['כרטיס','חשבון','תיאור','סכום כולל','תשלומים','חיוב ראשון','פעיל','הערה'],...model.state.credits.map(x=>[x.card,x.account,x.description,x.totalAmount,x.installments,x.firstChargeDate,x.active?'כן':'לא',x.note||''])];const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');downloadText(`${kind==='checks'?'checks':'credits'}_${todayISO()}.csv`,csv,'text/csv;charset=utf-8')}

function downloadText(name,text,type){const b=new Blob([text],{type}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

return { manualBackup, downloadJsonBackup, restoreBackup, switchFolder, exportCSV, downloadText };
}
