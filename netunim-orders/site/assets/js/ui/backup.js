import {stamp} from '../core/dates.js';
import {clone, esc} from '../core/values.js';
import {restoreJsonCounts} from '../state/validation.js';
import {normalizeSharedBankEvents, normalizeSharedChecks} from '../domains/checks/model.js';
import {CLOUD_BASE_KEY, $} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiBackup({tab, ui, model, session, checksSession, prepareState, normalizeState, validateRestoreJson, toast, showSecondaryTabGuard, modal, localSnapshot, markCloudPending, persistChecksBase, markChecksPending, setSave, folderBackupAvailable, folderSaveTitle, prepareCloudState, render, closeModal, writeStateSnapshotToFolder, writeStateToFolder, loadSession, readCloud, cloudEnabled, readSharedChecksCloud, saveSharedChecksToCloud, requestCloudSave, balanceRows, supplierYearContext, boolText}){
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}

function exportJson(){const payload=prepareState();downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`orders-backup_${stamp()}.json`)}

function beginJsonRestore(){
  if(!tab.primaryTab)return showSecondaryTabGuard();
  const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.style.display='none';document.body.appendChild(input);
  input.addEventListener('change',async()=>{const file=input.files?.[0];input.remove();if(!file)return;try{if(file.size>50*1024*1024)throw new Error('קובץ הגיבוי גדול מדי');const raw=JSON.parse(await file.text());const payload=validateRestoreJson(raw),c=restoreJsonCounts(payload),savedAt=payload?._meta?.savedAt||'לא ידוע';ui.pendingJsonRestore={payload,fileName:file.name};modal('שחזור מגיבוי JSON',`<div class="notice"><b>קובץ:</b> ${esc(file.name)}<br><b>נשמר:</b> ${esc(savedAt)}</div><div class="notice">ספקים: <b>${esc(c.suppliers)}</b> · תנועות: <b>${esc(c.transactions)}</b> · חובות: <b>${esc(c.customerDebts)}</b> · הזמנות לקוח: <b>${esc(c.customerOrders)}</b><br>קריאות שירות: <b>${esc(c.serviceCalls)}</b> · פריטי מלאי: <b>${esc(c.inventoryItems)}</b> · אירועי מלאי: <b>${esc(c.inventoryEvents)}</b> · הזמנות מחסן: <b>${esc(c.warehouseOrders)}</b> · פתקים: <b>${esc(c.notes)}</b></div><label style="display:flex;gap:8px;align-items:flex-start;margin-top:12px"><input id="restoreJsonChecks" type="checkbox"><span><b>שחזר גם ${esc(c.checks)} צ׳קים</b><br><small>הצ׳קים משותפים למערכת הקופה. ברירת המחדל היא להשאיר את הצ׳קים העדכניים מהקופה ולא לדרוס אותם.</small></span></label>`,`<button class="btn danger" data-action="apply-json-restore">שחזר את הגיבוי</button><button class="btn" data-action="pending-json-restore">ביטול</button>`)}catch(e){console.error('json restore read',e);toast('לא ניתן לפתוח את הגיבוי: '+(e.message||e))}});input.click()
}

async function applyJsonRestore(){
  if(!ui.pendingJsonRestore||!tab.primaryTab)return;
  const restoreChecks=!!$('#restoreJsonChecks')?.checked,imported=normalizeState(clone(ui.pendingJsonRestore.payload)),current=prepareState(),currentChecks=clone(model.state.checks||[]),fileName=ui.pendingJsonRestore.fileName||'JSON';
  if(!confirm(`לשחזר את הנתונים מהקובץ ${fileName}?\n\nלפני השחזור ייווצר אוטומטית גיבוי של המצב הנוכחי. ${restoreChecks?'גם הצ׳קים ישוחזרו ויסונכרנו לקופה.':'הצ׳קים הנוכחיים יישארו ללא שינוי.'}`))return;
  try{
    downloadBlob(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}),`orders-before-restore_${stamp()}.json`);
    if(folderBackupAvailable())await writeStateSnapshotToFolder(current,true);
    let remoteRow=null;if(cloudEnabled()&&navigator.onLine){remoteRow=await readCloud();if(!remoteRow)throw new Error('לא נמצא מסמך ניהול ההזמנות בענן');session.cloudRevision=Number(remoteRow.revision||0);session.lastCloudState=prepareCloudState(remoteRow.state||{});localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState))}
    if(restoreChecks&&loadSession()&&navigator.onLine){const kupaRow=await readSharedChecksCloud();if(!kupaRow)throw new Error('לא נמצא מסמך הקופה בענן');checksSession.checksCloudBase=normalizeSharedChecks(kupaRow.state?.checks||[]);checksSession.checksBankEvents=normalizeSharedBankEvents(kupaRow.state?.bankEvents);checksSession.checksCloudRevision=Number(kupaRow.revision||0);persistChecksBase(checksSession.checksCloudBase,checksSession.checksBankEvents)}
    model.state=imported;if(!restoreChecks)model.state.checks=currentChecks;ui.pendingJsonRestore=null;closeModal();session.localGeneration++;const localOk=localSnapshot();if(!localOk){model.state=normalizeState(clone(current));localSnapshot();throw new Error('השמירה המקומית לאחר השחזור נכשלה; המצב הקודם הוחזר')};
    if(cloudEnabled()){markCloudPending();session.cloudSaveRequested=true}if(folderBackupAvailable())await writeStateToFolder(true);
    let cloudOk=true;if(cloudEnabled())cloudOk=await requestCloudSave('גיבוי JSON שוחזר וסונכרן');
    let checksOk=true;if(restoreChecks&&loadSession()){checksSession.checksGeneration++;markChecksPending();checksSession.checksSaveRequested=true;checksOk=await saveSharedChecksToCloud('הצ׳קים מהגיבוי שוחזרו וסונכרנו')}
    render();setSave('מקומי: שמור','',folderSaveTitle());if(cloudOk&&checksOk)toast('השחזור הושלם ונשמר');else toast('השחזור נשמר מקומית; יש סנכרון שממתין להשלמה')
  }catch(e){console.error('json restore apply',e);toast('השחזור נעצר בבטחה: '+(e.message||e))}
}

function exportCsv(){const out=[['ספק','מספר','שנת ארכיון','חשבונית','פעולה','חובה','זכות','יתרה','חתום','סופק','פרטי אספקה','חמ','הערה','גיליון מקור','שורת מקור']];for(const s of model.state.suppliers){const years=supplierYearContext(s.id);for(const {t,balance} of balanceRows(s.id))out.push([s.name,t.sequence,years.yearById.get(t.id)||'',boolText(t.invoiceReceived),t.action,t.debit||'',t.credit||'',balance,boolText(t.signed),boolText(t.supplied),t.supplyInfo||'',t.hmIssued?'כן':'לא',t.note||'',t.source?.sheet||'',t.source?.row||''])}const csv='﻿'+out.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),`orders-export_${stamp()}.csv`)}

return { downloadBlob, exportJson, beginJsonRestore, applyJsonRestore, exportCsv };
}
