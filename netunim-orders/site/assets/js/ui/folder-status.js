import {$} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiFolderStatus({files}){
function syncFolderAccessButton(){
  const button=$('#folderAccessButton');
  if(!button)return;
  const {dirHandle,dirPermission,folderLastError}=files;
  const connected=!!dirHandle&&dirPermission==='granted';
  const needsPermission=!!dirHandle&&!connected;
  button.hidden=!folderLastError&&(dirPermission==='unknown'||connected);
  button.classList.toggle('folder-access-needed',!button.hidden&&(needsPermission||!!folderLastError));
  if(button.hidden){button.title='';return}
  button.textContent=folderLastError?'תיקייה !':dirHandle?'אשר תיקייה':'חבר תיקייה';
  button.title=folderLastError?`גיבוי התיקייה דורש טיפול: ${folderLastError}`:
    dirHandle?'נדרש אישור דפדפן מחדש לגישה לתיקיית הגיבוי':'חיבור תיקיית גיבוי מקומית';
}

function folderPermissionPending(){return !!files.dirHandle&&files.dirPermission!=='granted'}

function folderBackupAvailable(){return !!files.dirHandle&&files.dirPermission==='granted'&&!files.folderLastError}

function folderSaveTitle(){if(!files.dirHandle)return 'עותק הדפדפן שמור. תיקיית גיבוי לא חוברה.';if(files.dirPermission!=='granted')return 'עותק הדפדפן שמור. תיקיית הגיבוי ממתינה לאישור גישה.';if(files.folderLastError)return `עותק הדפדפן שמור. שגיאת תיקיית גיבוי: ${files.folderLastError}`;return 'עותק הדפדפן שמור וגם תיקיית הגיבוי מחוברת.'}

return { syncFolderAccessButton, folderPermissionPending, folderBackupAvailable, folderSaveTitle };
}
