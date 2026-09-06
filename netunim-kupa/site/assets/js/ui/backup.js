import {clone,esc} from '../core/values.js';
import {payloadFromState} from '../state/serialization.js';
import {todayISO} from '../core/dates.js';
import {normalizeSharedBankEvents,normalizeSharedChecks} from '../domains/checks/model.js';
import {buildBackupCatalog,backupPointKey,backupSourceLabel,summarizeBackupDiff} from '../shared/cloud-backups.js';
import {createRestoreGroup,executeRestoreGroup,resumeRestoreGroup} from '../shared/restore-groups.js';

const KUPA_BACKUP_COLLECTIONS=[
  {path:'checks',label:'צ׳קים'},{path:'credits',label:'עסקאות אשראי'},{path:'cash',label:'מזומן'},{path:'rights',label:'מעשר'},{path:'expenses',label:'הוצאות'},{path:'cards',label:'כרטיסים'},{path:'notes',label:'פתקים'},{path:'notesSheet.rows',label:'שורות גיליון'}
];
const KUPA_BACKUP_CONFIG=[
  {path:'businessName',label:'שם העסק'},{path:'rightsLastCalculatedDate',label:'תאריך חישוב מעשר'},{path:'cashflowSettings',label:'הגדרות תזרים'},{path:'notesSheet.columns',label:'מבנה גיליון'},{path:'bank.adjustments',label:'התאמות עו״ש ידניות'},{path:'bank.currentBalance',label:'יתרת עו״ש ידנית'}
];

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
function localDateTime(value){const d=new Date(value||'');return Number.isFinite(d.getTime())?d.toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'}):'זמן לא ידוע'}
const BACKUP_FIELD_LABELS={name:'שם',account:'חשבון',amount:'סכום',date:'תאריך',type:'סוג',description:'תיאור',note:'הערה',status:'סטטוס',dueDate:'תאריך פירעון',depositDate:'תאריך הפקדה',depositedAt:'הופקד',clearedDate:'נפרע',checkNumber:'מספר צ׳ק',card:'כרטיס',ownerLabel:'בעל הכרטיס',transactionDate:'תאריך עסקה',totalAmount:'סכום כולל',installments:'תשלומים',firstChargeDate:'חיוב ראשון',active:'פעיל',recurring:'קבועה',chargeDay:'יום חיוב',content:'תוכן',title:'כותרת',cells:'תאי גיליון'};
const BACKUP_TECH_FIELDS=new Set(['depositSeq','source','snapshotToken','snapshotSeq']);
function compactBackupValue(value){if(value===null||value===undefined||value==='')return '—';if(typeof value==='boolean')return value?'כן':'לא';if(typeof value==='number')return Number.isFinite(value)?value.toLocaleString('he-IL'):'—';if(Array.isArray(value))return `${value.length} פריטים`;if(typeof value==='object'){const text=JSON.stringify(value);return text.length>90?text.slice(0,87)+'…':text}const text=String(value);return text.length>100?text.slice(0,97)+'…':text}
function backupEntityTitle(path,row){if(!row)return 'רשומה';if(path==='checks')return `${row.name||'צ׳ק'}${row.checkNumber?` · ${row.checkNumber}`:''}${row.dueDate?` · ${row.dueDate}`:''}`;if(path==='credits')return `${row.description||row.card||'עסקת אשראי'}${row.card?` · ${row.card}`:''}${row.totalAmount?` · ${Number(row.totalAmount).toLocaleString('he-IL')} ₪`:''}`;if(path==='cash'||path==='rights')return `${row.description||row.type||'תנועה'}${row.date?` · ${row.date}`:''}${row.amount?` · ${Number(row.amount).toLocaleString('he-IL')} ₪`:''}`;if(path==='expenses')return `${row.description||'הוצאה'}${row.date?` · ${row.date}`:''}${row.amount?` · ${Number(row.amount).toLocaleString('he-IL')} ₪`:''}`;if(path==='cards')return `${row.name||row.card||'כרטיס'}${row.chargeDay?` · יום ${row.chargeDay}`:''}`;if(path==='notes')return String(row.content||'פתק').slice(0,70);if(path==='notesSheet.rows')return `שורת גיליון ${String(row.id||'').slice(-8)}`;return String(row.name||row.description||row.id||'רשומה').slice(0,80)}
function backupDetailMarkup(detail,row){const representative=detail.target||detail.current,title=backupEntityTitle(row.path,representative),verb=detail.type==='restored'?'תחזור מהגיבוי':detail.type==='removed'?'תוסר בשחזור':'תשתנה',fields=(detail.fields||[]).filter(field=>!BACKUP_TECH_FIELDS.has(field.key));let body='';if(detail.type==='changed'){const visible=fields.slice(0,8);body=visible.length?visible.map(field=>`<div class="cloud-backup-field-change"><b>${esc(BACKUP_FIELD_LABELS[field.key]||field.key)}</b><span class="cloud-backup-now">עכשיו: ${esc(compactBackupValue(field.current))}</span><span class="cloud-backup-target">אחרי שחזור: ${esc(compactBackupValue(field.target))}</span></div>`).join(''):'<div class="muted">ההבדל הוא בשדות מערכת/מטא־דאטה בלבד.</div>';if(fields.length>visible.length)body+=`<div class="muted">ועוד ${esc(fields.length-visible.length)} שדות שהשתנו.</div>`}else{body=`<div class="cloud-backup-field-change"><b>מצב הרשומה</b><span class="cloud-backup-now">עכשיו: ${esc(detail.type==='restored'?'לא קיימת':backupEntityTitle(row.path,detail.current))}</span><span class="cloud-backup-target">אחרי שחזור: ${esc(detail.type==='removed'?'לא תהיה קיימת':backupEntityTitle(row.path,detail.target))}</span></div>`}return `<div class="cloud-backup-entity-change"><div><b>${esc(title)}</b><small>${esc(verb)}</small></div>${body}</div>`}
function diffRowMarkup(row){const parts=[];if(row.removed)parts.push(`יוסרו ${row.removed}`);if(row.restored)parts.push(`יחזרו ${row.restored}`);if(row.changed)parts.push(`ישתנו ${row.changed}`);const details=row.details||[],visible=details.slice(0,40),more=details.length-visible.length;return `<details class="cloud-backup-diff-row"><summary><b>${esc(row.label)}</b><span>${esc(row.before)} ← ${esc(row.after)}</span><small>${esc(parts.join(' · ')||'ללא שינוי')}</small></summary><div class="cloud-backup-diff-details">${visible.map(detail=>backupDetailMarkup(detail,row)).join('')||'<div class="muted">אין פירוט נוסף.</div>'}${more?`<div class="muted">יש עוד ${esc(more)} רשומות שונות; הפירוט מוגבל ל־40 כדי לשמור על תצוגה מהירה.</div>`:''}</div></details>`}
function settingsDiffMarkup(setting){return `<div class="cloud-backup-field-change"><b>${esc(setting.label)}</b><span class="cloud-backup-now">עכשיו: ${esc(compactBackupValue(setting.current))}</span><span class="cloud-backup-target">אחרי שחזור: ${esc(compactBackupValue(setting.target))}</span></div>`}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiBackup({model,session,ui,files,checksSession,readJsonHandle,listBackups,createManualBackup,toast,renderSettings,stateFromPayload,persistImmediateBrowserSnapshot,persistSharedChecksBase,saveState,chooseFolder,prepareKupaCloudState,readSupabaseDocument,readSharedChecksDocument,getCloudPending,getSharedChecksPending,restoreGroupStore,stageRestoreGroup,applyRestoreGroup,listIncompleteRestoreGroups,listKupaCloudBackups,readKupaCloudBackupPoint,loadSupaSession,render,modal,closeModal,confirmDialog}){
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

  async function restoreState(state,{title='שחזור גיבוי',message='להחליף את הנתונים הנוכחיים בנתוני הגיבוי?',surface='backup.restore'}={}){
    const currentState=clone(model.state),cloudActive=session.connectionMode==='supabase'&&session.backendReady;
    if(!await confirmDialog(title,`${message} לפני כל כתיבה יישמר צילום בטיחות durable. במצב ענן הקופה והצ׳קים ישוחזרו בפעולה מאוחדת אחת.`,{confirmText:'שחזר גיבוי',cancelText:'ביטול',tone:'danger'}))return false;
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
      try{await saveState('הגיבוי שוחזר',{deleteIntents:restoreDeleteIntents(currentState,state),mutationType:'restore',surface})}catch(error){model.state=previous;throw error}
      render();
    };
    if(cloudActive)await executeRestoreGroup(group,{store:restoreGroupStore,stageRemote:stageRestoreGroup,applyRemote:applyRestoreGroup,onApplied:applyLocal});
    else{const staged=await restoreGroupStore.stage(group);await applyLocal(staged,{});await restoreGroupStore.complete(staged)}
    toast('השחזור הושלם ונשמר כפעולה מאוחדת');return true;
  }

  function restoreBackup(file){
    if(!file)return;const reader=new FileReader();
    reader.onload=async()=>{try{const state=stateFromPayload(JSON.parse(reader.result)).state;await restoreState(state)}catch(error){console.error('restore backup',error);alert('השחזור נעצר בבטחה: '+(error.message||'קובץ הגיבוי אינו תקין'))}};
    reader.readAsText(file,'utf-8');
  }

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

  async function switchFolder(){if(!await confirmDialog('מעבר לתיקיית קופה אחרת','השינויים הנוכחיים כבר נשמרו בקובץ המחובר. לעבור לתיקייה אחרת?',{confirmText:'עבור תיקייה',cancelText:'ביטול',tone:'primary'}))return;await chooseFolder()}
  function exportCSV(kind){let rows;if(kind==='checks')rows=[['שם','סיווג','סכום','תאריך פירעון','סטטוס','תאריך הפקדה','מספר צק','הערה'],...model.state.checks.map(row=>[row.name,row.account==='ביתי'?'ביתי':'עסקי',row.amount,row.dueDate,row.status,row.depositDate||'',row.checkNumber||'',row.note||''])];else rows=[['כרטיס','חשבון','תיאור','סכום כולל','תשלומים','חיוב ראשון','פעיל','הערה'],...model.state.credits.map(row=>[row.card,row.account,row.description,row.totalAmount,row.installments,row.firstChargeDate,row.active?'כן':'לא',row.note||''])];const csv='\ufeff'+rows.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');downloadText(`${kind==='checks'?'checks':'credits'}_${todayISO()}.csv`,csv,'text/csv;charset=utf-8')}
  function downloadText(name,text,type){const blob=new Blob([text],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

  return {manualBackup,downloadJsonBackup,restoreBackup,resumeIncompleteRestore,refreshCloudBackups,loadMoreCloudBackups,previewCloudBackup,downloadCloudBackup,downloadSelectedCloudBackup,applySelectedCloudBackup,switchFolder,exportCSV,downloadText};
}
