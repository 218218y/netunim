import {$} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiFolderStatus({files}){
function syncFolderAccessButton(){const b=$('#folderAccessButton');if(!b)return;if(!files.dirHandle){b.hidden=false;b.textContent='חבר תיקייה';b.classList.remove('folder-access-needed');b.title='חיבור תיקיית גיבוי מקומית';return}if(files.dirPermission==='granted'&&!files.folderLastError){b.hidden=true;b.classList.remove('folder-access-needed');b.title='';return}b.hidden=false;b.textContent=files.folderLastError?'תיקייה !':'אשר תיקייה';b.classList.add('folder-access-needed');b.title=files.folderLastError?`גיבוי התיקייה דורש טיפול: ${files.folderLastError}`:'נדרש אישור דפדפן מחדש לגישה לתיקיית הגיבוי'}

function folderPermissionPending(){return !!files.dirHandle&&files.dirPermission!=='granted'}

function folderBackupAvailable(){return !!files.dirHandle&&files.dirPermission==='granted'&&!files.folderLastError}

function folderSaveTitle(){if(!files.dirHandle)return 'עותק הדפדפן שמור. תיקיית גיבוי לא חוברה.';if(files.dirPermission!=='granted')return 'עותק הדפדפן שמור. תיקיית הגיבוי ממתינה לאישור גישה.';if(files.folderLastError)return `עותק הדפדפן שמור. שגיאת תיקיית גיבוי: ${files.folderLastError}`;return 'עותק הדפדפן שמור וגם תיקיית הגיבוי מחוברת.'}

return { syncFolderAccessButton, folderPermissionPending, folderBackupAvailable, folderSaveTitle };
}
