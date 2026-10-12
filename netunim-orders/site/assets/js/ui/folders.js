// Commands retain the selected directory across browser/storage awaits. A late
// completion cannot publish status or start a write for another selection.
export function createUiFolders({selection,authority,persistence,picker,view}){
  let pickerGeneration=0;
  function publishFailure(error,message,current){
    if(!current()||error.name==='AbortError')return;
    view.failure(error,message);
  }
  async function connect(current){
    await persistence.requestPersistence();if(!current())return false;
    const granted=await persistence.refreshPermission(true);if(!current())return false;
    if(!granted)throw new Error('אין הרשאת כתיבה');
    const preserved=await persistence.preserve();if(!current())return false;
    if(!preserved)throw new Error('שמירת התיקייה לא הושלמה');
    const saved=await persistence.write(true);if(!current())return false;
    if(!saved)throw new Error('שמירת התיקייה לא הושלמה');
    return true;
  }
  async function handleTopFolderAccess(){
    if(!authority.isPrimary())return authority.rejectSecondary();
    return selection.available()?activateSavedFolder():chooseFolder();
  }
  async function activateSavedFolder(){
    if(!authority.isPrimary())return authority.rejectSecondary();
    if(!selection.available())return chooseFolder();
    const current=selection.capture();
    try{if(await connect(current))view.success('הגישה לתיקייה אושרה והנתונים נשמרו')}
    catch(error){publishFailure(error,'לא ניתן לאשר גישה לתיקייה',current)}
  }
  async function chooseFolder(){
    if(!authority.isPrimary())return authority.rejectSecondary();
    if(!picker.isAvailable()){view.toast('הדפדפן אינו תומך בשמירה ישירה לתיקייה; אפשר להשתמש בייצוא JSON.');return}
    const generation=++pickerGeneration;
    let current=()=>authority.isPrimary()&&generation===pickerGeneration;
    try{
      const handle=await picker.pick();if(!current())return;
      if(!selection.select(handle))return;
      const selected=selection.capture();current=()=>generation===pickerGeneration&&selected();
      if(!current())return;
      await persistence.saveDirectory(handle);if(!current())return;
      if(await connect(current))view.success('התיקייה חוברה והנתונים נשמרו');
    }catch(error){publishFailure(error,'לא ניתן לחבר את התיקייה',current)}
  }
  async function backupToFolder(){
    if(!authority.isPrimary())return authority.rejectSecondary();
    if(!selection.available())return chooseFolder();
    const current=selection.capture();
    try{
      const granted=await persistence.refreshPermission(true);if(!current())return;
      if(!granted)throw new Error('אין הרשאת כתיבה');
      await persistence.requestPersistence();if(!current())return;
      const saved=await persistence.write(true);if(!current())return;
      if(!saved)throw new Error('גיבוי התיקייה לא הושלם');
      view.toast('נוצר גיבוי בתיקיית backups');
    }catch(error){publishFailure(error,'גיבוי לתיקייה נכשל',current)}
  }
  return {handleTopFolderAccess,activateSavedFolder,chooseFolder,backupToFolder};
}
