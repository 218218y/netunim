

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiFolders({files, tab, ui, showSecondaryTabGuard, toast, syncFolderAccessButton, requestPersistentBrowserStorage, refreshDirPermission, isFolderPermissionError, preserveExistingFolderState, writeStateToFolder, renderSettings, saveDirHandle}){
async function handleTopFolderAccess(){if(!tab.primaryTab)return showSecondaryTabGuard();return files.dirHandle?activateSavedFolder():chooseFolder()}

async function activateSavedFolder(){if(!files.dirHandle)return chooseFolder();if(!tab.primaryTab)return showSecondaryTabGuard();try{await requestPersistentBrowserStorage();if(!(await refreshDirPermission(true)))throw new Error('אין הרשאת כתיבה');await preserveExistingFolderState();const ok=await writeStateToFolder(true);if(!ok)throw new Error('שמירת התיקייה לא הושלמה');files.folderLastError='';syncFolderAccessButton();toast('הגישה לתיקייה אושרה והנתונים נשמרו');if(ui.currentView==='settings')renderSettings()}catch(e){console.error(e);if(!isFolderPermissionError(e))files.folderLastError=e.message||String(e);syncFolderAccessButton();toast('לא ניתן לאשר גישה לתיקייה')}}

async function chooseFolder(){if(!tab.primaryTab)return showSecondaryTabGuard();if(!window.showDirectoryPicker){toast('הדפדפן אינו תומך בשמירה ישירה לתיקייה; אפשר להשתמש בייצוא JSON.');return}try{const h=await showDirectoryPicker({mode:'readwrite'});files.dirHandle=h;files.folderWritePrepared=false;files.folderLastError='';await saveDirHandle(h);await requestPersistentBrowserStorage();if(!(await refreshDirPermission(true)))throw new Error('permission denied');await preserveExistingFolderState();const ok=await writeStateToFolder(true);if(!ok)throw new Error('שמירת התיקייה לא הושלמה');syncFolderAccessButton();toast('התיקייה חוברה והנתונים נשמרו');if(ui.currentView==='settings')renderSettings()}catch(e){if(e.name!=='AbortError'){console.error(e);if(!isFolderPermissionError(e))files.folderLastError=e.message||String(e);syncFolderAccessButton();toast('לא ניתן לחבר את התיקייה')}}}

async function backupToFolder(){if(!tab.primaryTab)return showSecondaryTabGuard();if(!files.dirHandle)return chooseFolder();try{if(!(await refreshDirPermission(true)))throw new Error('אין הרשאת כתיבה');await requestPersistentBrowserStorage();const ok=await writeStateToFolder(true);if(!ok)throw new Error('גיבוי התיקייה לא הושלם');toast('נוצר גיבוי בתיקיית backups')}catch(e){console.error(e);if(!isFolderPermissionError(e))files.folderLastError=e.message||String(e);syncFolderAccessButton();toast('גיבוי לתיקייה נכשל')}}

return { handleTopFolderAccess, activateSavedFolder, chooseFolder, backupToFolder };
}
