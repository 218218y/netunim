import {STORAGE_PREF_KEY} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiFolders({files, session, tab, ui, rememberHandle, rememberBackupHandle, showSecondaryTabGuard, permissionFor, ensureDirectoryFile, loadState, render, listBackups, backupSnapshotToComputer, toast, renderSettings, getRememberedHandle, getRememberedBackupHandle, showFirstRun, showRememberedFolderPrompt}){
async function connectDirectory(handle){if(!tab.primaryTab){showSecondaryTabGuard();return}if(!await permissionFor(handle))throw new Error('לא ניתנה הרשאת קריאה וכתיבה');files.rootDirHandle=handle;files.backupRootDirHandle=handle;session.connectionMode='directory';localStorage.setItem(STORAGE_PREF_KEY,'directory');files.dataFileHandle=await ensureDirectoryFile(handle);await rememberHandle(handle);await rememberBackupHandle(handle);await loadState();document.getElementById('connectScreen').style.display='none';render()}

async function chooseFolder(){try{if(!window.showDirectoryPicker)throw new Error('DIRECTORY_UNSUPPORTED');const h=await window.showDirectoryPicker({id:'kupa-main-folder',mode:'readwrite'});await connectDirectory(h)}catch(e){if(e.name==='AbortError')return;if(e.message==='DIRECTORY_UNSUPPORTED'){document.getElementById('chooseDataFile').style.display='inline-block';document.getElementById('connectNote').innerHTML='<b>הדפדפן לא מאפשר בחירת תיקייה.</b><br>אפשר לבחור ישירות את קובץ הנתונים; לשימוש מלא מומלץ Chrome או Edge עדכני.';return}console.error(e);alert('לא ניתן לפתוח את התיקייה: '+e.message)}}

async function connectDataFile(handle){if(!tab.primaryTab){showSecondaryTabGuard();return}if(!await permissionFor(handle))throw new Error('לא ניתנה הרשאת כתיבה');files.rootDirHandle=null;files.backupsDirHandle=null;session.connectionMode='file';localStorage.setItem(STORAGE_PREF_KEY,'file');files.dataFileHandle=handle;await loadState();document.getElementById('connectScreen').style.display='none';render()}

async function chooseDataFile(){try{if(window.showOpenFilePicker){const [h]=await window.showOpenFilePicker({id:'kupa-data-file',types:[{description:'קובץ נתוני קופה',accept:{'application/json':['.json']}}],multiple:false});await connectDataFile(h)}else{document.getElementById('legacyFileInput').click()}}catch(e){if(e.name!=='AbortError')alert('לא ניתן לפתוח את הקובץ: '+e.message)}}

async function chooseBackupFolder(){try{if(!window.showDirectoryPicker)throw new Error('הדפדפן אינו תומך בבחירת תיקיית גיבוי');const h=await window.showDirectoryPicker({id:'kupa-backup-folder',mode:'readwrite'});if(!await permissionFor(h))throw new Error('לא ניתנה הרשאת כתיבה');files.backupRootDirHandle=h;files.backupsDirHandle=await h.getDirectoryHandle('backups',{create:true});await rememberBackupHandle(h);session.serverInfo.backups=await listBackups();await backupSnapshotToComputer();toast('תיקיית הגיבוי המקומית חוברה');if(ui.currentPage==='settings')renderSettings()}catch(e){if(e.name!=='AbortError'){console.error(e);alert('לא ניתן לחבר תיקיית גיבוי: '+e.message)}}}

async function restoreRememberedBackupTarget(){try{const h=await getRememberedBackupHandle()||await getRememberedHandle();if(!h)return false;const p=await h.queryPermission?.({mode:'readwrite'});if(p!=='granted')return false;files.backupRootDirHandle=h;files.backupsDirHandle=await h.getDirectoryHandle('backups',{create:true});session.serverInfo.backups=await listBackups();return true}catch(e){console.error('restore backup target',e);return false}}

async function openLastFolder(){const h=await getRememberedHandle();if(!h)return showFirstRun();try{await connectDirectory(h)}catch(e){console.error(e);showRememberedFolderPrompt('לא ניתן לפתוח את הקופה השמורה. אפשר לאשר גישה מחדש או לבחור תיקייה אחרת.')}}

return { connectDirectory, chooseFolder, connectDataFile, chooseDataFile, chooseBackupFolder, restoreRememberedBackupTarget, openLastFolder };
}
