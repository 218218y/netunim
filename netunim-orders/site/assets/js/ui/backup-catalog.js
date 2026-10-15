import {buildBackupCatalog,backupPointKey,summarizeBackupDiff,backupSourceLabel} from '../shared/cloud-backups.js';
import {clone,esc} from '../core/values.js';
import {ORDERS_BACKUP_COLLECTIONS,ORDERS_BACKUP_CONFIG,localDateTime,diffRowMarkup,settingsDiffMarkup} from './backup-presentation.js';
import {stamp} from '../core/dates.js';

// Owns cloud backup catalog and preview through explicit ports.
export function createBackupCatalog({model,ui,projection={},view={},cloud={},restore,browser}){
  const downloadBlob=(...args)=>browser.download(...args);
  const {prepareState,normalizeState}=projection;
  const {toast,modal,renderSettings,closeModal}=view;
  const {cloudEnabled,listOrdersCloudBackups,readOrdersCloudBackupPoint}=cloud;
  const {restoreNormalizedState}=restore;

let pendingScope=null,pendingEntry=null,pendingSurface=null;
function current(scope){try{scope.assertCurrent();return true}catch{return false}}
function invalidate(){
  if(pendingEntry===ui.pendingCloudBackup)ui.pendingCloudBackup=null;
  pendingScope=null;pendingEntry=null;
  if(pendingSurface?.isConnected)closeModal();pendingSurface=null;
  ui.cloudBackupCatalog=[];ui.cloudBackupRaw=null;ui.cloudBackupHasMore=false;
  ui.cloudBackupLoading=false;ui.cloudBackupLoadingMore=false;ui.cloudBackupError='';
}

function rebuildCloudBackupCatalog(){const raw=ui.cloudBackupRaw||{rolling:[],periodic:[]},expanded=Number(ui.cloudBackupVisibleLimit||8)>8;ui.cloudBackupCatalog=expanded?buildBackupCatalog(raw.rolling,raw.periodic,{rollingLimit:raw.rolling.length,periodicLimit:raw.periodic.length,totalLimit:ui.cloudBackupVisibleLimit}):buildBackupCatalog(raw.rolling,raw.periodic)}

async function refreshCloudBackups(){
    if(!cloudEnabled()){ui.cloudBackupCatalog=[];ui.cloudBackupRaw=null;ui.cloudBackupHasMore=false;ui.cloudBackupError='גיבויי ענן זמינים לאחר התחברות ל־Supabase.';return renderSettings()}
    ui.cloudBackupLoading=true;ui.cloudBackupLoadingMore=false;ui.cloudBackupError='';renderSettings();
    const scope=browser.capture('download');
    return browser.run(scope,async()=>{try{const raw=await listOrdersCloudBackups({limit:8});scope.assertCurrent();ui.cloudBackupRaw={rolling:raw.rolling||[],periodic:raw.periodic||[]};ui.cloudBackupVisibleLimit=8;ui.cloudBackupHasMore=(raw.rolling?.length===8)||(raw.periodic?.length===8);rebuildCloudBackupCatalog()}catch(error){if(!current(scope))return false;console.error('orders cloud backup list',error);ui.cloudBackupCatalog=[];ui.cloudBackupRaw=null;ui.cloudBackupHasMore=false;ui.cloudBackupError=error.message||'קריאת גיבויי הענן נכשלה'}finally{if(current(scope)){ui.cloudBackupLoading=false;renderSettings()}}});
  }

async function loadMoreCloudBackups(){
    if(ui.cloudBackupLoading||ui.cloudBackupLoadingMore)return;if(!ui.cloudBackupRaw)return refreshCloudBackups();if(!ui.cloudBackupHasMore)return;ui.cloudBackupLoadingMore=true;ui.cloudBackupError='';renderSettings();
    const scope=browser.capture('download');
    return browser.run(scope,async()=>{try{const raw=ui.cloudBackupRaw,page=await listOrdersCloudBackups({limit:8,rollingOffset:raw.rolling.length,periodicOffset:raw.periodic.length});scope.assertCurrent();raw.rolling.push(...(page.rolling||[]));raw.periodic.push(...(page.periodic||[]));ui.cloudBackupVisibleLimit=Number(ui.cloudBackupVisibleLimit||8)+8;ui.cloudBackupHasMore=(page.rolling?.length===8)||(page.periodic?.length===8);rebuildCloudBackupCatalog()}catch(error){if(!current(scope))return false;console.error('orders cloud backup load more',error);ui.cloudBackupError=error.message||'קריאת גיבויים קודמים נכשלה'}finally{if(current(scope)){ui.cloudBackupLoadingMore=false;renderSettings()}}});
  }

function cloudPointTargetState(point){
    if(!point?.checksState?.checks)throw new Error('לא נמצא צילום צ׳קים מתאים לנקודת הזמן הזאת');
    return normalizeState({...clone(point.state),checks:clone(point.checksState.checks)});
  }

async function loadCloudBackupPoint(source,id,scope=browser.capture('download')){
  scope.assertCurrent();const key=backupPointKey(source,id);
  if(ui.pendingCloudBackup===pendingEntry&&pendingEntry?.key===key&&pendingEntry.point){pendingScope.assertCurrent();return pendingEntry}
  return browser.run(scope,async()=>{
    const point=await readOrdersCloudBackupPoint(source,id);scope.assertCurrent();
    const targetState=point.checksState?cloudPointTargetState(point):null,diff=targetState?summarizeBackupDiff(model.state,targetState,{collections:ORDERS_BACKUP_COLLECTIONS,config:ORDERS_BACKUP_CONFIG}):null;
    pendingScope=scope;pendingEntry={key,point,targetState,diff};ui.pendingCloudBackup=pendingEntry;return pendingEntry;
  });
}

function previewMarkup(entry){
    const {point,diff}=entry,rows=diff?.rows||[],settings=diff?.settings||[],checksInfo=point.checksState?`צ׳קים: r${esc(point.checksRevision)} · ${esc(localDateTime(point.checksSavedAt))}`:'לא נמצא צילום צ׳קים מתאים';
    return `<div class="cloud-backup-preview"><div class="notice"><b>${esc(backupSourceLabel(point.source))}</b> · הזמנות r${esc(point.revision)} · ${esc(localDateTime(point.savedAt))}<br><small>${checksInfo}</small></div>${point.checksState?'<div class="soft-note">השחזור יחזיר את מסמך ההזמנות ואת הצ׳קים לאותה נקודת זמן. יומן אירועי הבנק של הצ׳קים נשמר מהמצב החי כדי למנוע הפעלה חוזרת של השפעות כספיות.</div>':'<div class="notice danger"><b>שחזור אוטומטי מושבת:</b> אין צילום צ׳קים קוהרנטי לנקודת הזמן הזאת.</div>'}<div class="cloud-backup-diff">${rows.length?rows.map(row=>diffRowMarkup(row,entry)).join(''):'<div class="muted">אין הבדלים מהותיים באוספים הראשיים.</div>'}${settings.length?`<details class="cloud-backup-settings-diff"><summary><b>הגדרות שישתנו (${esc(settings.length)})</b></summary><div class="cloud-backup-diff-details">${settings.map(settingsDiffMarkup).join('')}</div></details>`:''}</div></div>`;
  }

async function previewCloudBackup(source,id){
    try{const scope=browser.capture('download'),entry=await loadCloudBackupPoint(source,id,scope);scope.assertCurrent();const enabled=!!entry.point.checksState;modal('תצוגה מקדימה של גיבוי ענן',previewMarkup(entry),`<button class="btn" data-action="download-selected-orders-cloud-backup" ${enabled?'':'disabled'}>הורד JSON</button><button class="btn danger" data-action="apply-orders-cloud-backup-restore" ${enabled?'':'disabled'}>שחזר לנקודה זו</button><button class="btn" data-action="close-modal">סגור</button>`);pendingSurface=globalThis.document?.querySelector('.cloud-backup-preview')}catch(error){if(error?.code==='backup_file_scope_changed')return false;console.error('orders cloud backup preview',error);toast('לא ניתן לפתוח את הגיבוי: '+(error.message||error))}
  }

async function downloadCloudBackup(source,id){
    try{const scope=browser.capture('download'),entry=await loadCloudBackupPoint(source,id,scope);scope.assertCurrent();if(!entry.targetState)throw new Error('אין צילום צ׳קים מתאים ולכן לא נוצר קובץ חלקי');const payload=prepareState(entry.targetState);payload._meta={...payload._meta,cloudBackup:{source:entry.point.source,primarySavedAt:entry.point.savedAt,checksRevision:entry.point.checksRevision,checksSavedAt:entry.point.checksSavedAt}};downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`orders-cloud-backup_r${entry.point.revision}_${String(entry.point.savedAt||'').slice(0,10)||stamp()}.json`,scope);toast('גיבוי הענן הורד')}catch(error){if(error?.code==='backup_file_scope_changed')return false;console.error('orders cloud backup download',error);toast('הורדת הגיבוי נכשלה: '+(error.message||error))}
  }

async function downloadSelectedCloudBackup(){const entry=ui.pendingCloudBackup;if(!entry?.point)return;await downloadCloudBackup(entry.point.source,entry.point.id)}

async function applySelectedCloudBackup(){
  const entry=ui.pendingCloudBackup;if(!entry?.targetState||entry!==pendingEntry||!pendingScope)return false;
  const readScope=pendingScope;if(!current(readScope))return false;
  const scope=browser.capture('restore'),assertFileCurrent=()=>{readScope.assertCurrent();scope.assertCurrent()};
  return browser.run(scope,async()=>{
    closeModal();const done=await restoreNormalizedState(entry.targetState,{restoreChecks:true,title:'שחזור נקודת ענן',message:`להחזיר את ניהול ההזמנות והצ׳קים למצב של ${localDateTime(entry.point.savedAt)}?`,surface:'backup.cloud-restore',assertFileCurrent,signal:scope.signal});
    if(done){ui.pendingCloudBackup=null;await refreshCloudBackups()}return done;
  });
}

return {invalidate,rebuildCloudBackupCatalog,refreshCloudBackups,loadMoreCloudBackups,cloudPointTargetState,loadCloudBackupPoint,previewMarkup,previewCloudBackup,downloadCloudBackup,downloadSelectedCloudBackup,applySelectedCloudBackup};
}
