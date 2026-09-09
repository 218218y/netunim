import {stamp} from '../core/dates.js';
import {clone,esc} from '../core/values.js';
import {restoreJsonCounts} from '../state/validation.js';
import {normalizeSharedBankEvents,normalizeSharedChecks} from '../domains/checks/model.js';
import {CLOUD_BASE_KEY,$} from '../state/constants.js';
import {buildBackupCatalog,backupPointKey,backupSourceLabel,summarizeBackupDiff} from '../shared/cloud-backups.js';
import {createRestoreGroup,executeRestoreGroup,resumeRestoreGroup} from '../shared/restore-groups.js';

const ORDERS_BACKUP_COLLECTIONS=[
  {path:'suppliers',label:'ספקים'},
  {path:'transactions',label:'תנועות ספק'},
  {path:'customerDebts',label:'חובות לקוחות'},
  {path:'customerOrders',label:'הזמנות לקוח'},
  {path:'serviceCalls',label:'קריאות שירות'},
  {path:'inventoryItems',label:'פריטי מלאי'},
  {path:'inventoryEvents',label:'אירועי מלאי'},
  {path:'warehouseOrders',label:'הזמנות מחסן'},
  {path:'notes',label:'פתקים'},
  {path:'checks',label:'צ׳קים'},
];
const ORDERS_BACKUP_CONFIG=[{path:'inventoryCategoryOrder',label:'סדר קטגוריות מלאי'}];

function restoreDeleteIntents(before,after){
  const out={};
  for(const key of ['suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes','inventoryItems','inventoryEvents','warehouseOrders']){
    const kept=new Set((after?.[key]||[]).map(row=>String(row?.id||'')));
    const ids=(before?.[key]||[]).map(row=>String(row?.id||'')).filter(id=>id&&!kept.has(id));
    if(ids.length)out[key]=ids;
  }
  return out;
}
function localDateTime(value){const d=new Date(value||'');return Number.isFinite(d.getTime())?d.toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'}):'זמן לא ידוע'}
const BACKUP_FIELD_LABELS={name:'שם',supplierId:'ספק',sequence:'מספר שורה',invoiceReceived:'חשבונית התקבלה',action:'פעולה',debit:'חובה',credit:'זכות',signed:'חתום',supplied:'סופק',supplyInfo:'פרטי אספקה',hmIssued:'ח״מ',note:'הערה',yearEnd:'סוף שנה',customerName:'לקוח',orderNumber:'מספר הזמנה',amount:'סכום',amountValue:'סכום',debtProgress:'התקדמות תשלום/חשבונית',phone:'טלפון',mattresses:'מזרנים',suppliedAt:'תאריך אספקה',paidAt:'תאריך תשלום',invoiceIssued:'חשבונית הוצאה',invoiceIssuedAt:'תאריך חשבונית',closedAt:'תאריך סגירה',mark1:'סימון 1',mark2:'סימון 2',mark3:'סימון 3',address:'כתובת',assignee:'אחראי',description:'תיאור',openedAt:'נפתח',followUp:'מעקב',escalated:'הקפצה',nextFollowUp:'מעקב הבא',closed:'סגור',category:'קטגוריה',location:'מיקום',active:'פעיל',itemId:'פריט',type:'סוג',quantity:'כמות',receivedQuantity:'כמות שהתקבלה',pickedAt:'נאסף',releasedAt:'שוחרר',status:'סטטוס',details:'פרטים',account:'חשבון',dueDate:'תאריך פירעון',depositDate:'תאריך הפקדה',depositedAt:'הופקד',clearedDate:'נפרע',checkNumber:'מספר צ׳ק',content:'תוכן'};
const BACKUP_TECH_FIELDS=new Set(['source','sortOrder','archivedAt','pickedUp','reserved']);
function compactBackupValue(value){if(value===null||value===undefined||value==='')return '—';if(typeof value==='boolean')return value?'כן':'לא';if(typeof value==='number')return Number.isFinite(value)?value.toLocaleString('he-IL'):'—';if(Array.isArray(value))return `${value.length} פריטים`;if(typeof value==='object'){const text=JSON.stringify(value);return text.length>90?text.slice(0,87)+'…':text}const text=String(value);return text.length>100?text.slice(0,97)+'…':text}
function supplierName(id,entry){const key=String(id||'');return entry?.targetState?.suppliers?.find(x=>String(x.id)===key)?.name||model.state.suppliers?.find(x=>String(x.id)===key)?.name||key||'ספק לא ידוע'}
function inventoryItemName(id,entry){const key=String(id||'');return entry?.targetState?.inventoryItems?.find(x=>String(x.id)===key)?.name||model.state.inventoryItems?.find(x=>String(x.id)===key)?.name||key||'פריט לא ידוע'}
function displayBackupFieldValue(key,value,entry){if(key==='supplierId')return supplierName(value,entry);if(key==='itemId')return inventoryItemName(value,entry);return compactBackupValue(value)}
function backupEntityTitle(path,row,entry){if(!row)return 'רשומה';if(path==='transactions')return `${supplierName(row.supplierId,entry)}${row.sequence?` · שורה ${row.sequence}`:''}${row.action?` · ${row.action}`:''}`;if(path==='suppliers')return row.name||'ספק';if(path==='customerDebts'||path==='customerOrders')return `${row.customerName||'לקוח'}${row.orderNumber?` · הזמנה ${row.orderNumber}`:''}`;if(path==='serviceCalls')return `${row.customerName||'לקוח'}${row.orderNumber?` · ${row.orderNumber}`:''}`;if(path==='inventoryItems')return row.name||'פריט מלאי';if(path==='inventoryEvents')return `${inventoryItemName(row.itemId,entry)}${row.type?` · ${row.type}`:''}`;if(path==='warehouseOrders')return `${row.customerName||'הזמנת מחסן'}${row.details?` · ${String(row.details).slice(0,45)}`:''}`;if(path==='checks')return `${row.name||'צ׳ק'}${row.checkNumber?` · ${row.checkNumber}`:''}${row.dueDate?` · ${row.dueDate}`:''}`;if(path==='notes')return String(row.content||'פתק').slice(0,70);return String(row.name||row.description||row.customerName||row.id||'רשומה').slice(0,80)}
function backupDetailMarkup(detail,row,entry){const representative=detail.target||detail.current,title=backupEntityTitle(row.path,representative,entry),verb=detail.type==='restored'?'תחזור מהגיבוי':detail.type==='removed'?'תוסר בשחזור':'תשתנה',fields=(detail.fields||[]).filter(field=>!BACKUP_TECH_FIELDS.has(field.key));let body='';if(detail.type==='changed'){const visible=fields.slice(0,8);body=visible.length?visible.map(field=>`<div class="cloud-backup-field-change"><b>${esc(BACKUP_FIELD_LABELS[field.key]||field.key)}</b><span class="cloud-backup-now">עכשיו: ${esc(displayBackupFieldValue(field.key,field.current,entry))}</span><span class="cloud-backup-target">אחרי שחזור: ${esc(displayBackupFieldValue(field.key,field.target,entry))}</span></div>`).join(''):'<div class="muted">ההבדל הוא בשדות מערכת/מטא־דאטה בלבד.</div>';if(fields.length>visible.length)body+=`<div class="muted">ועוד ${esc(fields.length-visible.length)} שדות שהשתנו.</div>`}else{const current=detail.type==='restored'?'לא קיימת':backupEntityTitle(row.path,detail.current,entry),target=detail.type==='removed'?'לא תהיה קיימת':backupEntityTitle(row.path,detail.target,entry);body=`<div class="cloud-backup-field-change"><b>מצב הרשומה</b><span class="cloud-backup-now">עכשיו: ${esc(current)}</span><span class="cloud-backup-target">אחרי שחזור: ${esc(target)}</span></div>`}return `<div class="cloud-backup-entity-change"><div><b>${esc(title)}</b><small>${esc(verb)}</small></div>${body}</div>`}
function diffRowMarkup(row,entry){const parts=[];if(row.removed)parts.push(`יוסרו ${row.removed}`);if(row.restored)parts.push(`יחזרו ${row.restored}`);if(row.changed)parts.push(`ישתנו ${row.changed}`);const details=row.details||[],visible=details.slice(0,40),more=details.length-visible.length;return `<details class="cloud-backup-diff-row"><summary><b>${esc(row.label)}</b><span>${esc(row.before)} ← ${esc(row.after)}</span><small>${esc(parts.join(' · ')||'ללא שינוי')}</small></summary><div class="cloud-backup-diff-details">${visible.map(detail=>backupDetailMarkup(detail,row,entry)).join('')||'<div class="muted">אין פירוט נוסף.</div>'}${more?`<div class="muted">יש עוד ${esc(more)} רשומות שונות; הפירוט מוגבל ל־40 כדי לשמור על תצוגה מהירה.</div>`:''}</div></details>`}
function settingsDiffMarkup(setting){return `<div class="cloud-backup-field-change"><b>${esc(setting.label)}</b><span class="cloud-backup-now">עכשיו: ${esc(compactBackupValue(setting.current))}</span><span class="cloud-backup-target">אחרי שחזור: ${esc(compactBackupValue(setting.target))}</span></div>`}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiBackup({tab,ui,model,session,checksSession,prepareState,normalizeState,validateRestoreJson,toast,showSecondaryTabGuard,modal,localSnapshot,getCloudPending,getChecksPending,persistChecksBase,setSave,folderBackupAvailable,folderSaveTitle,prepareCloudState,render,renderSettings,closeModal,writeStateSnapshotToFolder,writeStateToFolder,loadSession,readCloud,cloudEnabled,readSharedChecksCloud,restoreGroupStore,stageRestoreGroup,applyRestoreGroup,listIncompleteRestoreGroups,listOrdersCloudBackups,readOrdersCloudBackupPoint,balanceRows,supplierYearContext,boolText,confirmDialog}){
  function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}

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
        modal('שחזור מגיבוי JSON',`<div class="notice"><b>קובץ:</b> ${esc(file.name)}<br><b>נשמר:</b> ${esc(savedAt)}</div><div class="notice">ספקים: <b>${esc(counts.suppliers)}</b> · תנועות: <b>${esc(counts.transactions)}</b> · חובות: <b>${esc(counts.customerDebts)}</b> · הזמנות לקוח: <b>${esc(counts.customerOrders)}</b><br>קריאות שירות: <b>${esc(counts.serviceCalls)}</b> · פריטי מלאי: <b>${esc(counts.inventoryItems)}</b> · אירועי מלאי: <b>${esc(counts.inventoryEvents)}</b> · הזמנות מחסן: <b>${esc(counts.warehouseOrders)}</b> · פתקים: <b>${esc(counts.notes)}</b></div><label style="display:flex;gap:8px;align-items:flex-start;margin-top:12px"><input id="restoreJsonChecks" type="checkbox"><span><b>שחזר גם ${esc(counts.checks)} צ׳קים</b><br><small>הצ׳קים הם מסמך משותף נפרד. ללא סימון, המסמך העדכני יישאר ללא שינוי.</small></span></label>`,`<button class="btn danger" data-action="apply-json-restore">שחזר את הגיבוי</button><button class="btn" data-action="pending-json-restore">ביטול</button>`);
      }catch(error){console.error('json restore read',error);toast('לא ניתן לפתוח את הגיבוי: '+(error.message||error))}
    });
    input.click();
  }

  async function applyCompletedGroupLocally(group,result={}){
    const previous=clone(model.state),target=normalizeState(clone(group.localTargetState||{...group.main.state,checks:group.checks?.state?.checks||group.beforeState?.local?.checks||[]}));
    model.state=target;session.localGeneration++;session.cloudRevision=Number(result.main_revision||session.cloudRevision||group.main.baseRevision);session.cloudUpdatedAt=new Date().toISOString();session.lastCloudState=clone(group.main.state);localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(group.main.state));
    if(group.checks){checksSession.checksCloudBase=clone(group.checks.state.checks);checksSession.checksBankEvents=clone(group.checks.state.bankEvents||[]);checksSession.checksCloudRevision=Number(result.checks_revision||checksSession.checksCloudRevision||group.checks.baseRevision);persistChecksBase(checksSession.checksCloudBase,checksSession.checksBankEvents)}
    if(!localSnapshot()){model.state=normalizeState(previous);localSnapshot();throw new Error('שמירת המצב המקומי לאחר השחזור נכשלה; השחזור נשאר ניתן לחידוש')}
    render();return true;
  }

  async function resumeIncompleteRestore(){
    if(!tab.primaryTab||!navigator.onLine||!loadSession())return false;
    const resumed=await resumeRestoreGroup({store:restoreGroupStore,stageRemote:stageRestoreGroup,applyRemote:applyRestoreGroup,onApplied:applyCompletedGroupLocally});
    if(resumed){toast('שחזור שנקטע הושלם בבטחה');return true}
    const serverGroups=await listIncompleteRestoreGroups();for(const row of serverGroups.filter(item=>item.app_site==='orders'))await applyRestoreGroup(row.restore_group_id);
    return serverGroups.some(item=>item.app_site==='orders');
  }

  async function restoreNormalizedState(source,{restoreChecks=true,title='אישור שחזור גיבוי',message='לשחזר את נתוני הגיבוי?',surface='backup.restore',beforeDownload=true}={}){
    if(!tab.primaryTab)return showSecondaryTabGuard();
    const imported=normalizeState(clone(source)),current=prepareState(),currentChecks=clone(model.state.checks||[]);
    if(!await confirmDialog(title,`${message}\n\nלפני השחזור יישמר צילום בטיחות durable. ${restoreChecks?'גם מסמך הצ׳קים ישוחזר באותה פעולת restore.':'מסמך הצ׳קים יישאר ללא שינוי.'}`,{confirmText:'שחזר גיבוי',cancelText:'ביטול',tone:'danger'}))return false;
    try{
      if(beforeDownload)downloadBlob(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}),`orders-before-restore_${stamp()}.json`);
      if(folderBackupAvailable())await writeStateSnapshotToFolder(current,true);
      const cloudActive=cloudEnabled();if(!restoreChecks)imported.checks=currentChecks;
      const mainState=prepareCloudState(imported);let remoteRow=null,checksRow=null;
      if(cloudActive){
        if(!navigator.onLine||!loadSession())throw new Error('שחזור ענן דורש חיבור פעיל כדי לקבע את כל היעדים לפני הכתיבה');
        if(await getCloudPending()||(restoreChecks&&await getChecksPending()))throw new Error('קיים שינוי מקומי שממתין לסנכרון; יש להשלים או לפתור אותו לפני שחזור');
        remoteRow=await readCloud();if(!remoteRow)throw new Error('לא נמצא מסמך ניהול ההזמנות בענן');
        if(restoreChecks){checksRow=await readSharedChecksCloud();if(!checksRow)throw new Error('לא נמצא מסמך הצ׳קים המשותף בענן')}
      }
      const checksState=restoreChecks?{version:1,checks:normalizeSharedChecks(imported.checks),bankEvents:normalizeSharedBankEvents(checksRow?.state?.bankEvents||checksSession.checksBankEvents)}:null;
      const checksBefore=checksRow?.state?.checks||currentChecks;
      const checksDeleteIds=checksState?checksBefore.map(row=>String(row.id)).filter(id=>!checksState.checks.some(row=>row.id===id)):[];
      const group=await createRestoreGroup({
        appSite:'orders',
        main:{documentName:'suppliers',baseRevision:Number(remoteRow?.revision||session.cloudRevision||0),state:mainState,deleteIntents:restoreDeleteIntents(remoteRow?.state||current,mainState)},
        checks:checksState?{documentName:'main',baseRevision:Number(checksRow?.revision||checksSession.checksCloudRevision||0),state:checksState,deleteIds:checksDeleteIds}:null,
        beforeState:{local:current,main:clone(remoteRow?.state||current),checks:clone(checksRow?.state||{checks:currentChecks,bankEvents:checksSession.checksBankEvents||[]})},
        localTargetState:imported,
      });
      const applyLocal=cloudActive?applyCompletedGroupLocally:async()=>{const previous=clone(model.state);model.state=normalizeState(clone(imported));session.localGeneration++;if(!localSnapshot()){model.state=normalizeState(previous);localSnapshot();throw new Error('שמירת המצב המקומי לאחר השחזור נכשלה')}render()};
      if(cloudActive)await executeRestoreGroup(group,{store:restoreGroupStore,stageRemote:stageRestoreGroup,applyRemote:applyRestoreGroup,onApplied:applyLocal});
      else{const staged=await restoreGroupStore.stage(group);await applyLocal(staged,{});await restoreGroupStore.complete(staged)}
      if(folderBackupAvailable())await writeStateToFolder(true);setSave('מקומי: שמור','',folderSaveTitle());toast('השחזור הושלם ונשמר כפעולה מאוחדת');return true;
    }catch(error){console.error(surface,error);toast('השחזור נעצר בבטחה: '+(error.message||error));return false}
  }

  async function applyJsonRestore(){
    if(!ui.pendingJsonRestore||!tab.primaryTab)return;
    const restoreChecks=!!$('#restoreJsonChecks')?.checked,fileName=ui.pendingJsonRestore.fileName||'JSON',payload=normalizeState(clone(ui.pendingJsonRestore.payload));
    const done=await restoreNormalizedState(payload,{restoreChecks,title:'אישור שחזור גיבוי',message:`לשחזר את הנתונים מהקובץ ${fileName}?`,surface:'backup.json-restore'});
    if(done){ui.pendingJsonRestore=null;closeModal()}
  }

  function rebuildCloudBackupCatalog(){const raw=ui.cloudBackupRaw||{rolling:[],periodic:[]},expanded=Number(ui.cloudBackupVisibleLimit||8)>8;ui.cloudBackupCatalog=expanded?buildBackupCatalog(raw.rolling,raw.periodic,{rollingLimit:raw.rolling.length,periodicLimit:raw.periodic.length,totalLimit:ui.cloudBackupVisibleLimit}):buildBackupCatalog(raw.rolling,raw.periodic)}
  async function refreshCloudBackups(){
    if(!cloudEnabled()){ui.cloudBackupCatalog=[];ui.cloudBackupRaw=null;ui.cloudBackupHasMore=false;ui.cloudBackupError='גיבויי ענן זמינים לאחר התחברות ל־Supabase.';return renderSettings()}
    ui.cloudBackupLoading=true;ui.cloudBackupLoadingMore=false;ui.cloudBackupError='';renderSettings();
    try{const raw=await listOrdersCloudBackups({limit:8});ui.cloudBackupRaw={rolling:raw.rolling||[],periodic:raw.periodic||[]};ui.cloudBackupVisibleLimit=8;ui.cloudBackupHasMore=(raw.rolling?.length===8)||(raw.periodic?.length===8);rebuildCloudBackupCatalog()}catch(error){console.error('orders cloud backup list',error);ui.cloudBackupCatalog=[];ui.cloudBackupRaw=null;ui.cloudBackupHasMore=false;ui.cloudBackupError=error.message||'קריאת גיבויי הענן נכשלה'}finally{ui.cloudBackupLoading=false;renderSettings()}
  }
  async function loadMoreCloudBackups(){
    if(ui.cloudBackupLoading||ui.cloudBackupLoadingMore)return;if(!ui.cloudBackupRaw)return refreshCloudBackups();if(!ui.cloudBackupHasMore)return;ui.cloudBackupLoadingMore=true;ui.cloudBackupError='';renderSettings();
    try{const raw=ui.cloudBackupRaw,page=await listOrdersCloudBackups({limit:8,rollingOffset:raw.rolling.length,periodicOffset:raw.periodic.length});raw.rolling.push(...(page.rolling||[]));raw.periodic.push(...(page.periodic||[]));ui.cloudBackupVisibleLimit=Number(ui.cloudBackupVisibleLimit||8)+8;ui.cloudBackupHasMore=(page.rolling?.length===8)||(page.periodic?.length===8);rebuildCloudBackupCatalog()}catch(error){console.error('orders cloud backup load more',error);ui.cloudBackupError=error.message||'קריאת גיבויים קודמים נכשלה'}finally{ui.cloudBackupLoadingMore=false;renderSettings()}
  }

  function cloudPointTargetState(point){
    if(!point?.checksState?.checks)throw new Error('לא נמצא צילום צ׳קים מתאים לנקודת הזמן הזאת');
    return normalizeState({...clone(point.state),checks:clone(point.checksState.checks)});
  }
  async function loadCloudBackupPoint(source,id){
    const key=backupPointKey(source,id);if(ui.pendingCloudBackup?.key===key&&ui.pendingCloudBackup?.point)return ui.pendingCloudBackup;
    const point=await readOrdersCloudBackupPoint(source,id),targetState=point.checksState?cloudPointTargetState(point):null,diff=targetState?summarizeBackupDiff(model.state,targetState,{collections:ORDERS_BACKUP_COLLECTIONS,config:ORDERS_BACKUP_CONFIG}):null;
    ui.pendingCloudBackup={key,point,targetState,diff};return ui.pendingCloudBackup;
  }
  function previewMarkup(entry){
    const {point,diff}=entry,rows=diff?.rows||[],settings=diff?.settings||[],checksInfo=point.checksState?`צ׳קים: r${esc(point.checksRevision)} · ${esc(localDateTime(point.checksSavedAt))}`:'לא נמצא צילום צ׳קים מתאים';
    return `<div class="cloud-backup-preview"><div class="notice"><b>${esc(backupSourceLabel(point.source))}</b> · הזמנות r${esc(point.revision)} · ${esc(localDateTime(point.savedAt))}<br><small>${checksInfo}</small></div>${point.checksState?'<div class="soft-note">השחזור יחזיר את מסמך ההזמנות ואת הצ׳קים לאותה נקודת זמן. יומן אירועי הבנק של הצ׳קים נשמר מהמצב החי כדי למנוע הפעלה חוזרת של השפעות כספיות.</div>':'<div class="notice danger"><b>שחזור אוטומטי מושבת:</b> אין צילום צ׳קים קוהרנטי לנקודת הזמן הזאת.</div>'}<div class="cloud-backup-diff">${rows.length?rows.map(row=>diffRowMarkup(row,entry)).join(''):'<div class="muted">אין הבדלים מהותיים באוספים הראשיים.</div>'}${settings.length?`<details class="cloud-backup-settings-diff"><summary><b>הגדרות שישתנו (${esc(settings.length)})</b></summary><div class="cloud-backup-diff-details">${settings.map(settingsDiffMarkup).join('')}</div></details>`:''}</div></div>`;
  }
  async function previewCloudBackup(source,id){
    try{const entry=await loadCloudBackupPoint(source,id),enabled=!!entry.point.checksState;modal('תצוגה מקדימה של גיבוי ענן',previewMarkup(entry),`<button class="btn" data-action="download-selected-orders-cloud-backup" ${enabled?'':'disabled'}>הורד JSON</button><button class="btn danger" data-action="apply-orders-cloud-backup-restore" ${enabled?'':'disabled'}>שחזר לנקודה זו</button><button class="btn" data-action="close-modal">סגור</button>`)}catch(error){console.error('orders cloud backup preview',error);toast('לא ניתן לפתוח את הגיבוי: '+(error.message||error))}
  }
  async function downloadCloudBackup(source,id){
    try{const entry=await loadCloudBackupPoint(source,id);if(!entry.targetState)throw new Error('אין צילום צ׳קים מתאים ולכן לא נוצר קובץ חלקי');const payload=prepareState(entry.targetState);payload._meta={...payload._meta,cloudBackup:{source:entry.point.source,primarySavedAt:entry.point.savedAt,checksRevision:entry.point.checksRevision,checksSavedAt:entry.point.checksSavedAt}};downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`orders-cloud-backup_r${entry.point.revision}_${String(entry.point.savedAt||'').slice(0,10)||stamp()}.json`);toast('גיבוי הענן הורד')}catch(error){console.error('orders cloud backup download',error);toast('הורדת הגיבוי נכשלה: '+(error.message||error))}
  }
  async function downloadSelectedCloudBackup(){const entry=ui.pendingCloudBackup;if(!entry?.point)return;await downloadCloudBackup(entry.point.source,entry.point.id)}
  async function applySelectedCloudBackup(){
    const entry=ui.pendingCloudBackup;if(!entry?.targetState)return toast('אין נקודת גיבוי מלאה לשחזור');
    closeModal();const done=await restoreNormalizedState(entry.targetState,{restoreChecks:true,title:'שחזור נקודת ענן',message:`להחזיר את ניהול ההזמנות והצ׳קים למצב של ${localDateTime(entry.point.savedAt)}?`,surface:'backup.cloud-restore'});
    if(done){ui.pendingCloudBackup=null;await refreshCloudBackups()}
  }

  function exportCsv(){
    const out=[['ספק','מספר','שנת ארכיון','חשבונית','פעולה','חובה','זכות','יתרה','חתום','סופק','פרטי אספקה','חמ','הערה','גיליון מקור','שורת מקור']];
    for(const supplier of model.state.suppliers){const years=supplierYearContext(supplier.id);for(const {t,balance} of balanceRows(supplier.id))out.push([supplier.name,t.sequence,years.yearById.get(t.id)||'',boolText(t.invoiceReceived),t.action,t.debit||'',t.credit||'',balance,boolText(t.signed),boolText(t.supplied),t.supplyInfo||'',t.hmIssued?'כן':'לא',t.note||'',t.source?.sheet||'',t.source?.row||''])}
    const csv='\ufeff'+out.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),`orders-export_${stamp()}.csv`);
  }

  return {downloadBlob,exportJson,beginJsonRestore,applyJsonRestore,resumeIncompleteRestore,refreshCloudBackups,loadMoreCloudBackups,previewCloudBackup,downloadCloudBackup,downloadSelectedCloudBackup,applySelectedCloudBackup,exportCsv};
}
