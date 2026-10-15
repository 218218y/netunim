import {stamp} from '../core/dates.js';
import {restoreJsonCounts} from '../state/validation.js';
import {esc,clone} from '../core/values.js';
import {$} from '../state/constants.js';

// Owns local import/export through explicit ports.
export function createBackupLocal({model,ui,tab,projection={},view={},restore,browser}){
  const downloadBlob=(...args)=>browser.download(...args);
  const {prepareState,normalizeState,validateRestoreJson,balanceRows,supplierYearContext,boolText}=projection;
  const {toast,showSecondaryTabGuard,modal,closeModal}=view;
  const {restoreNormalizedState}=restore;

function exportJson(){const payload=prepareState();downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`orders-backup_${stamp()}.json`)}

let pendingReview=null,previewSurface=null;
function invalidate(){
  if(pendingReview?.value===ui.pendingJsonRestore)ui.pendingJsonRestore=null;
  pendingReview=null;
  if(previewSurface?.isConnected)closeModal();previewSurface=null;
}
async function beginJsonRestore(){
  if(!tab.primaryTab)return showSecondaryTabGuard();
  try{
    return await browser.choose((raw,file,scope)=>{
        const payload=validateRestoreJson(JSON.parse(raw)),counts=restoreJsonCounts(payload),savedAt=payload?._meta?.savedAt||'לא ידוע';
        scope.assertCurrent();ui.pendingJsonRestore={payload,fileName:file.name};
        pendingReview={value:ui.pendingJsonRestore,scope};
        modal('שחזור מגיבוי JSON',`<div class="backup-json-preview"><div class="notice"><b>קובץ:</b> ${esc(file.name)}<br><b>נשמר:</b> ${esc(savedAt)}</div><div class="notice">ספקים: <b>${esc(counts.suppliers)}</b> · תנועות: <b>${esc(counts.transactions)}</b> · חובות: <b>${esc(counts.customerDebts)}</b> · הזמנות לקוח: <b>${esc(counts.customerOrders)}</b><br>קריאות שירות: <b>${esc(counts.serviceCalls)}</b> · פריטי מלאי: <b>${esc(counts.inventoryItems)}</b> · אירועי מלאי: <b>${esc(counts.inventoryEvents)}</b> · הזמנות מחסן: <b>${esc(counts.warehouseOrders)}</b> · פתקים: <b>${esc(counts.notes)}</b></div><p>גיבוי, ייצוא ושחזור הגליונות נמצאים בסרגל הגליון. הגליונות נשמרים בנפרד מגיבויי המערכת.</p><label style="display:flex;gap:8px;align-items:flex-start;margin-top:12px"><input id="restoreJsonChecks" type="checkbox"><span><b>שחזר גם ${esc(counts.checks)} צ׳קים</b><br><small>הצ׳קים הם מסמך משותף נפרד. ללא סימון, המסמך העדכני יישאר ללא שינוי.</small></span></label></div>`,`<button class="btn danger" data-action="apply-json-restore">שחזר את הגיבוי</button><button class="btn" data-action="pending-json-restore">ביטול</button>`);
        previewSurface=$('.backup-json-preview');return true;
    },50*1024*1024);
  }catch(error){if(error?.code==='backup_file_scope_changed')return false;console.error('json restore read',error);toast('לא ניתן לפתוח את הגיבוי: '+(error.message||error));return false}
}

async function applyJsonRestore(){
    if(!ui.pendingJsonRestore||!tab.primaryTab||pendingReview?.value!==ui.pendingJsonRestore)return;
    const {scope}=pendingReview;
    try{scope.assertCurrent()}catch{invalidate();return false}
    const restoreChecks=!!$('#restoreJsonChecks')?.checked,fileName=ui.pendingJsonRestore.fileName||'JSON',payload=normalizeState(clone(ui.pendingJsonRestore.payload));
    const done=await browser.run(scope,()=>restoreNormalizedState(payload,{restoreChecks,title:'אישור שחזור גיבוי',message:`לשחזר את הנתונים מהקובץ ${fileName}?`,surface:'backup.json-restore',assertFileCurrent:scope.assertCurrent,signal:scope.signal}));
    if(done){pendingReview=null;previewSurface=null;ui.pendingJsonRestore=null;closeModal()}
  }

function exportCsv(){
    const out=[['ספק','מספר','שנת ארכיון','חשבונית','פעולה','חובה','זכות','יתרה','חתום','סופק','פרטי אספקה','הערה','גליון מקור','שורת מקור']];
    for(const supplier of model.state.suppliers){const years=supplierYearContext(supplier.id);for(const {t,balance} of balanceRows(supplier.id))out.push([supplier.name,t.sequence,years.yearById.get(t.id)||'',boolText(t.invoiceReceived),t.action,t.debit||'',t.credit||'',balance,boolText(t.signed),boolText(t.supplied),t.supplyInfo||'',t.note||'',t.source?.sheet||'',t.source?.row||''])}
    const csv='\ufeff'+out.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),`orders-export_${stamp()}.csv`);
  }

return {invalidate,exportJson,beginJsonRestore,applyJsonRestore,exportCsv};
}
