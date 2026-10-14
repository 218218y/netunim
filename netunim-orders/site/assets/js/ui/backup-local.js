import {downloadBlob} from './backup-download.js';
import {stamp} from '../core/dates.js';
import {restoreJsonCounts} from '../state/validation.js';
import {esc,clone} from '../core/values.js';
import {$} from '../state/constants.js';

// Owns local import/export through explicit ports.
export function createBackupLocal({model,ui,tab,projection={},view={},restore}){
  const {prepareState,normalizeState,validateRestoreJson,balanceRows,supplierYearContext,boolText}=projection;
  const {toast,showSecondaryTabGuard,modal,closeModal}=view;
  const {restoreNormalizedState}=restore;

function exportJson(){const payload=prepareState();downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`orders-backup_${stamp()}.json`)}

function beginJsonRestore(){
    if(!tab.primaryTab)return showSecondaryTabGuard();
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.style.display='none';document.body.appendChild(input);
    input.addEventListener('change',async()=>{
      const file=input.files?.[0];input.remove();if(!file)return;
      try{
        if(file.size>50*1024*1024)throw new Error('קובץ הגיבוי גדול מדי');
        const payload=validateRestoreJson(JSON.parse(await file.text())),counts=restoreJsonCounts(payload),savedAt=payload?._meta?.savedAt||'לא ידוע';
        ui.pendingJsonRestore={payload,fileName:file.name};
        modal('שחזור מגיבוי JSON',`<div class="notice"><b>קובץ:</b> ${esc(file.name)}<br><b>נשמר:</b> ${esc(savedAt)}</div><div class="notice">ספקים: <b>${esc(counts.suppliers)}</b> · תנועות: <b>${esc(counts.transactions)}</b> · חובות: <b>${esc(counts.customerDebts)}</b> · הזמנות לקוח: <b>${esc(counts.customerOrders)}</b><br>קריאות שירות: <b>${esc(counts.serviceCalls)}</b> · פריטי מלאי: <b>${esc(counts.inventoryItems)}</b> · אירועי מלאי: <b>${esc(counts.inventoryEvents)}</b> · הזמנות מחסן: <b>${esc(counts.warehouseOrders)}</b> · פתקים: <b>${esc(counts.notes)}</b></div><p>גיבוי, ייצוא ושחזור הגליונות נמצאים בסרגל הגליון. הגליונות נשמרים בנפרד מגיבויי המערכת.</p><label style="display:flex;gap:8px;align-items:flex-start;margin-top:12px"><input id="restoreJsonChecks" type="checkbox"><span><b>שחזר גם ${esc(counts.checks)} צ׳קים</b><br><small>הצ׳קים הם מסמך משותף נפרד. ללא סימון, המסמך העדכני יישאר ללא שינוי.</small></span></label>`,`<button class="btn danger" data-action="apply-json-restore">שחזר את הגיבוי</button><button class="btn" data-action="pending-json-restore">ביטול</button>`);
      }catch(error){console.error('json restore read',error);toast('לא ניתן לפתוח את הגיבוי: '+(error.message||error))}
    });
    input.click();
  }

async function applyJsonRestore(){
    if(!ui.pendingJsonRestore||!tab.primaryTab)return;
    const restoreChecks=!!$('#restoreJsonChecks')?.checked,fileName=ui.pendingJsonRestore.fileName||'JSON',payload=normalizeState(clone(ui.pendingJsonRestore.payload));
    const done=await restoreNormalizedState(payload,{restoreChecks,title:'אישור שחזור גיבוי',message:`לשחזר את הנתונים מהקובץ ${fileName}?`,surface:'backup.json-restore'});
    if(done){ui.pendingJsonRestore=null;closeModal()}
  }

function exportCsv(){
    const out=[['ספק','מספר','שנת ארכיון','חשבונית','פעולה','חובה','זכות','יתרה','חתום','סופק','פרטי אספקה','הערה','גליון מקור','שורת מקור']];
    for(const supplier of model.state.suppliers){const years=supplierYearContext(supplier.id);for(const {t,balance} of balanceRows(supplier.id))out.push([supplier.name,t.sequence,years.yearById.get(t.id)||'',boolText(t.invoiceReceived),t.action,t.debit||'',t.credit||'',balance,boolText(t.signed),boolText(t.supplied),t.supplyInfo||'',t.note||'',t.source?.sheet||'',t.source?.row||''])}
    const csv='\ufeff'+out.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),`orders-export_${stamp()}.csv`);
  }

return {exportJson,beginJsonRestore,applyJsonRestore,exportCsv};
}
