import {buildBackupCatalog,backupPointKey,summarizeBackupDiff,backupSourceLabel} from '../shared/cloud-backups.js';
import {payloadFromState} from '../state/serialization.js';
import {clone,esc} from '../core/values.js';
import {KUPA_BACKUP_COLLECTIONS,KUPA_BACKUP_CONFIG,localDateTime,diffRowMarkup,settingsDiffMarkup} from './backup-presentation.js';
import {downloadText} from './backup-download.js';
import {todayISO} from '../core/dates.js';

// Owns cloud backup catalog and preview through explicit ports.
export function createBackupCatalog({model,session,ui,projection={},view={},cloud={},restore}){
  const {stateFromPayload}=projection;
  const {toast,modal,renderSettings,closeModal}=view;
  const {listKupaCloudBackups,readKupaCloudBackupPoint}=cloud;
  const {restoreState}=restore;

function rebuildCloudBackupCatalog(){const raw=ui.cloudBackupRaw||{rolling:[],periodic:[]},expanded=Number(ui.cloudBackupVisibleLimit||8)>8;ui.cloudBackupCatalog=expanded?buildBackupCatalog(raw.rolling,raw.periodic,{rollingLimit:raw.rolling.length,periodicLimit:raw.periodic.length,totalLimit:ui.cloudBackupVisibleLimit}):buildBackupCatalog(raw.rolling,raw.periodic)}

async function refreshCloudBackups(){
    if(session.connectionMode!=='supabase'||!session.backendReady){ui.cloudBackupCatalog=[];ui.cloudBackupRaw=null;ui.cloudBackupHasMore=false;ui.cloudBackupError='גיבויי ענן זמינים כאשר הקופה פתוחה מ־Supabase.';return renderSettings()}
    ui.cloudBackupLoading=true;ui.cloudBackupLoadingMore=false;ui.cloudBackupError='';renderSettings();
    try{const raw=await listKupaCloudBackups({limit:8});ui.cloudBackupRaw={rolling:raw.rolling||[],periodic:raw.periodic||[]};ui.cloudBackupVisibleLimit=8;ui.cloudBackupHasMore=(raw.rolling?.length===8)||(raw.periodic?.length===8);rebuildCloudBackupCatalog()}catch(error){console.error('cloud backup list',error);ui.cloudBackupCatalog=[];ui.cloudBackupRaw=null;ui.cloudBackupHasMore=false;ui.cloudBackupError=error.message||'קריאת גיבויי הענן נכשלה'}finally{ui.cloudBackupLoading=false;renderSettings()}
  }

async function loadMoreCloudBackups(){
    if(ui.cloudBackupLoading||ui.cloudBackupLoadingMore)return;if(!ui.cloudBackupRaw)return refreshCloudBackups();if(!ui.cloudBackupHasMore)return;ui.cloudBackupLoadingMore=true;ui.cloudBackupError='';renderSettings();
    try{const raw=ui.cloudBackupRaw,page=await listKupaCloudBackups({limit:8,rollingOffset:raw.rolling.length,periodicOffset:raw.periodic.length});raw.rolling.push(...(page.rolling||[]));raw.periodic.push(...(page.periodic||[]));ui.cloudBackupVisibleLimit=Number(ui.cloudBackupVisibleLimit||8)+8;ui.cloudBackupHasMore=(page.rolling?.length===8)||(page.periodic?.length===8);rebuildCloudBackupCatalog()}catch(error){console.error('cloud backup load more',error);ui.cloudBackupError=error.message||'קריאת גיבויים קודמים נכשלה'}finally{ui.cloudBackupLoadingMore=false;renderSettings()}
  }

function cloudPointPortableState(point){
    if(!point?.checksState?.checks)throw new Error('לא נמצא צילום צ׳קים מתאים לנקודת הזמן הזאת');
    return stateFromPayload(payloadFromState({...clone(point.state),checks:clone(point.checksState.checks)},point.revision)).state;
  }

function cloudPointRestoreState(point){
    const target=clone(point.state),live=clone(model.state),coreBank=target.bank&&typeof target.bank==='object'?target.bank:{},financeBank=live.bank&&typeof live.bank==='object'?clone(live.bank):null;
    if(financeBank){delete financeBank.adjustments;delete financeBank.snapshotToken;delete financeBank.snapshotSeq;if(financeBank.source!=='hapoalim'){delete financeBank.currentBalance;delete financeBank.updatedAt;delete financeBank.asOfDate;delete financeBank.source;delete financeBank.sourceAccount}target.bank={...coreBank,...financeBank,adjustments:clone(coreBank.adjustments||[]),snapshotToken:coreBank.snapshotToken??null,snapshotSeq:coreBank.snapshotSeq??null}}
    if(live.creditSync&&typeof live.creditSync==='object')target.creditSync=clone(live.creditSync);
    target.checks=clone(point.checksState?.checks||[]);return stateFromPayload(payloadFromState(target,point.revision)).state;
  }

async function loadCloudBackupPoint(source,id){const key=backupPointKey(source,id);if(ui.pendingCloudBackup?.key===key&&ui.pendingCloudBackup?.point)return ui.pendingCloudBackup;const point=await readKupaCloudBackupPoint(source,id),portableState=point.checksState?cloudPointPortableState(point):null,restoreStateTarget=point.checksState?cloudPointRestoreState(point):null,diff=restoreStateTarget?summarizeBackupDiff(model.state,restoreStateTarget,{collections:KUPA_BACKUP_COLLECTIONS,config:KUPA_BACKUP_CONFIG}):null;ui.pendingCloudBackup={key,point,portableState,restoreState:restoreStateTarget,diff};return ui.pendingCloudBackup}

function previewMarkup(entry){
    const {point,diff}=entry,rows=diff?.rows||[],settings=diff?.settings||[],checksInfo=point.checksState?`צ׳קים: r${esc(point.checksRevision)} · ${esc(localDateTime(point.checksSavedAt))}`:'לא נמצא צילום צ׳קים מתאים';
    return `<div class="cloud-backup-preview"><div class="notice"><b>${esc(backupSourceLabel(point.source))}</b> · קופה r${esc(point.revision)} · ${esc(localDateTime(point.savedAt))}<br><small>${checksInfo}</small></div>${point.checksState?`<div class="soft-note">נתוני הבנק והאשראי המסונכרנים אינם חלק מגיבויי הקופה בענן ולא יוחזרו אחורה. השחזור משאיר את ה־finance sync החי במקומו.</div>`:`<div class="notice danger"><b>שחזור אוטומטי מושבת:</b> אין צילום צ׳קים קוהרנטי לנקודת הזמן הזאת.</div>`}<div class="cloud-backup-diff">${rows.length?rows.map(diffRowMarkup).join(''):'<div class="muted">אין הבדלים מהותיים באוספים הראשיים.</div>'}${settings.length?`<details class="cloud-backup-settings-diff"><summary><b>הגדרות שישתנו (${esc(settings.length)})</b></summary><div class="cloud-backup-diff-details">${settings.map(settingsDiffMarkup).join('')}</div></details>`:''}</div><div class="backup-actions" style="margin-top:14px"><button class="btn" data-action="download-selected-cloud-backup" ${point.checksState?'':'disabled'}>הורד JSON</button></div></div>`;
  }

async function previewCloudBackup(source,id){
    try{const entry=await loadCloudBackupPoint(source,id);modal('תצוגה מקדימה של גיבוי ענן',previewMarkup(entry),entry.point.checksState?'שחזר לנקודה זו':'סגור',entry.point.checksState?()=>applySelectedCloudBackup():()=>closeModal())}catch(error){console.error('cloud backup preview',error);toast('לא ניתן לפתוח את הגיבוי: '+(error.message||error))}
  }

async function downloadCloudBackup(source,id){
    try{const entry=await loadCloudBackupPoint(source,id);if(!entry.portableState)throw new Error('אין צילום צ׳קים מתאים ולכן לא נוצר קובץ חלקי');const payload=payloadFromState(entry.portableState,entry.point.revision);payload._meta={...payload._meta,cloudBackup:{source:entry.point.source,primarySavedAt:entry.point.savedAt,checksRevision:entry.point.checksRevision,checksSavedAt:entry.point.checksSavedAt,financeSyncIncluded:false}};downloadText(`kupa-cloud-backup_r${entry.point.revision}_${String(entry.point.savedAt||todayISO()).slice(0,10)}.json`,JSON.stringify(payload,null,2),'application/json;charset=utf-8');toast('גיבוי הענן הורד') }catch(error){console.error('cloud backup download',error);toast('הורדת הגיבוי נכשלה: '+(error.message||error))}
  }

async function downloadSelectedCloudBackup(){const entry=ui.pendingCloudBackup;if(!entry?.point)return;await downloadCloudBackup(entry.point.source,entry.point.id)}

async function applySelectedCloudBackup(){
    const entry=ui.pendingCloudBackup;if(!entry?.restoreState)return toast('אין נקודת גיבוי מלאה לשחזור');
    try{closeModal(true);const done=await restoreState(entry.restoreState,{title:'שחזור נקודת ענן',message:`להחזיר את הקופה והצ׳קים למצב של ${localDateTime(entry.point.savedAt)}?`,surface:'backup.cloud-restore'});if(done){ui.pendingCloudBackup=null;await refreshCloudBackups()}}catch(error){console.error('cloud backup restore',error);alert('השחזור נעצר בבטחה: '+(error.message||error))}
  }

return {rebuildCloudBackupCatalog,refreshCloudBackups,loadMoreCloudBackups,cloudPointPortableState,cloudPointRestoreState,loadCloudBackupPoint,previewMarkup,previewCloudBackup,downloadCloudBackup,downloadSelectedCloudBackup,applySelectedCloudBackup};
}
