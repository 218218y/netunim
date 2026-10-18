import {STORAGE_PREF_KEY} from '../state/constants.js';
import {createLocalSourceTransition} from '../storage/local-source-transition.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiFolders({files, session, tab, ui, rememberHandle, rememberBackupHandle, showSecondaryTabGuard, permissionFor, prepareDirectory, loadState, render, listBackups, backupSnapshotToComputer, toast, renderSettings, getRememberedHandle, getRememberedBackupHandle, showFirstRun, showRememberedFolderPrompt, captureSourceScope, drainSources, resumeSources}){
const transition=createLocalSourceTransition({captureScope:captureSourceScope,drain:drainSources,setBusy:value=>{session.localSourceSwitchPending=value;if(!value)resumeSources()}});
let pickerGeneration=0;

function primary(){if(tab.primaryTab)return true;showSecondaryTabGuard();return false}

function installSource(source){
  const {connectionMode,...handles}=source;
  Object.assign(files,handles);
  session.connectionMode=connectionMode;
}

async function rememberSource(source){
  try{
    localStorage.setItem(STORAGE_PREF_KEY,source.connectionMode);
    if(source.rootDirHandle){
      const root=await rememberHandle(source.rootDirHandle),backup=await rememberBackupHandle(source.backupRootDirHandle);
      if(root===false||backup===false)throw new Error('storage_source_handle_not_remembered');
    }
  }catch(error){console.error('remember connected source',error);toast('המקור חובר, אך פתיחתו האוטומטית בפעם הבאה לא נשמרה.')}
}

async function adoptSource(source,assertCurrent,{automatic=false}={}){
  await loadState({automatic,source,assertCurrent,installSource:()=>{assertCurrent();installSource(source)}});
  assertCurrent();
  document.getElementById('connectScreen').style.display='none';
  render();
  await rememberSource(source);
  return true;
}

async function connectDirectory(handle,{automatic=false,permissionGranted=false}={}){
  if(!primary())return false;
  return transition.run(async assertCurrent=>{
    if(!permissionGranted&&!await permissionFor(handle))throw new Error('לא ניתנה הרשאת קריאה וכתיבה');
    assertCurrent();
    return prepareDirectory(handle);
  },(source,assertCurrent)=>adoptSource(source,assertCurrent,{automatic}));
}

async function chooseFolder(){
  if(!primary())return;
  const selection=++pickerGeneration;
  try{
    if(!window.showDirectoryPicker)throw new Error('DIRECTORY_UNSUPPORTED');
    const handle=await window.showDirectoryPicker({id:'kupa-main-folder',mode:'readwrite'});
    if(selection===pickerGeneration)await connectDirectory(handle);
  }catch(error){
    if(selection!==pickerGeneration||error.name==='AbortError')return;
    if(error.message==='DIRECTORY_UNSUPPORTED'){
      document.getElementById('chooseDataFile').style.display='inline-block';
      document.getElementById('connectNote').innerHTML='<b>הדפדפן לא מאפשר בחירת תיקייה.</b><br>אפשר לבחור ישירות את קובץ הנתונים; לשימוש מלא מומלץ Chrome או Edge עדכני.';
      return;
    }
    console.error(error);alert('לא ניתן לפתוח את התיקייה: '+error.message);
  }
}

async function connectDataFile(handle){
  if(!primary())return false;
  return transition.run(async assertCurrent=>{
    if(!await permissionFor(handle))throw new Error('לא ניתנה הרשאת כתיבה');
    assertCurrent();
    return {rootDirHandle:null,backupRootDirHandle:null,backupsDirHandle:null,dataFileHandle:handle,connectionMode:'file'};
  },adoptSource);
}

async function chooseDataFile(){
  if(!primary())return;
  const selection=++pickerGeneration;
  try{
    if(window.showOpenFilePicker){
      const [handle]=await window.showOpenFilePicker({id:'kupa-data-file',types:[{description:'קובץ נתוני קופה',accept:{'application/json':['.json']}}],multiple:false});
      if(selection===pickerGeneration)await connectDataFile(handle);
    }else document.getElementById('legacyFileInput').click();
  }catch(error){if(selection===pickerGeneration&&error.name!=='AbortError')alert('לא ניתן לפתוח את הקובץ: '+error.message)}
}

async function connectBackupTarget(handle,{automatic=false}={}){
  if(!primary())return false;
  return transition.run(async assertCurrent=>{
    if(!automatic&&!await permissionFor(handle))throw new Error('לא ניתנה הרשאת כתיבה');
    assertCurrent();
    const directory=await handle.getDirectoryHandle('backups',{create:true});assertCurrent();
    const backups=await listBackups(directory);assertCurrent();
    return {handle,directory,backups};
  },async(candidate,assertCurrent)=>{
    assertCurrent();
    files.backupRootDirHandle=candidate.handle;files.backupsDirHandle=candidate.directory;
    session.serverInfo.backups=candidate.backups;
    if(!automatic){
      try{if(await rememberBackupHandle(candidate.handle)===false)throw new Error('backup_handle_not_remembered')}
      catch(error){console.error('remember backup target',error);toast('תיקיית הגיבוי חוברה, אך לא נשמרה לפתיחה הבאה.')}
      try{await backupSnapshotToComputer()}
      catch(error){console.error('connected backup target snapshot',error);toast('התיקייה חוברה, אך יצירת הגיבוי נכשלה. יש לנסות שוב.')}
    }
    return true;
  });
}

async function chooseBackupFolder(){
  if(!primary())return;
  try{
    if(!window.showDirectoryPicker)throw new Error('הדפדפן אינו תומך בבחירת תיקיית גיבוי');
    const handle=await window.showDirectoryPicker({id:'kupa-backup-folder',mode:'readwrite'});
    if(await connectBackupTarget(handle)){toast('תיקיית הגיבוי המקומית חוברה');if(ui.currentPage==='settings')renderSettings()}
  }catch(error){if(error.name!=='AbortError'){console.error(error);alert('לא ניתן לחבר תיקיית גיבוי: '+error.message)}}
}

async function restoreRememberedBackupTarget(){
  try{
    const handle=await getRememberedBackupHandle()||await getRememberedHandle();
    if(!handle||await handle.queryPermission?.({mode:'readwrite'})!=='granted')return false;
    return await connectBackupTarget(handle,{automatic:true});
  }catch(error){console.error('restore backup target',error);return false}
}

async function openLastFolder(){const h=await getRememberedHandle();if(!h)return showFirstRun();try{await connectDirectory(h)}catch(e){console.error(e);showRememberedFolderPrompt('לא ניתן לפתוח את הקופה השמורה. אפשר לאשר גישה מחדש או לבחור תיקייה אחרת.')}}

return { connectDirectory, chooseFolder, connectDataFile, chooseDataFile, chooseBackupFolder, restoreRememberedBackupTarget, openLastFolder };
}
