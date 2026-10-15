import {equalSyncJson} from '../shared/cloud-sync.js';
import {payloadFromState} from '../state/serialization.js';
import {assertPortablePayload} from '../state/validation.js';
import {mainBusinessState} from './main-state.js';

// Export only journaled Main and Shared state. Revision conflicts remain fenced
// until explicit adoption; file success cannot acknowledge either cloud head.
export function createLocalFileMirror({model,session,journal,file,view}){
const {storageV2CommitPromise,sharedChecksV2,recoverStorageV2State}=journal;
const {files,readJsonHandle,writeJsonHandleVerified,listBackups,backupSnapshotToComputer}=file;
const {setSaveStatus,reportError,toast}=view;
async function persistState(snapshot,msg,generation=session.localGeneration){
  if(!files.dataFileHandle){setSaveStatus('אין קובץ נתונים','error');return false}
  if(session.localFileConflictPending){setSaveStatus('התנגשות בקובץ — השינוי שמור ב־V2','error');return false}
  setSaveStatus(generation===session.localGeneration?'שומר…':'שומר תור שינויים…','saving');
  try{
    // A file is an export of the journals. Never let it create or replace a
    // Main checkpoint, even when the owner has no cloud cursor.
    await storageV2CommitPromise();
    if(!sharedChecksV2?.flush||!sharedChecksV2?.recoverReadOnly)throw new Error('storage_v2_local_file_shared_head_required');
    await sharedChecksV2.flush();
    const [recovered,shared]=await Promise.all([recoverStorageV2State(),sharedChecksV2.recoverReadOnly()]);
    if(!recovered||!equalSyncJson(mainBusinessState(recovered.state),mainBusinessState(model.state)))throw new Error('storage_v2_local_file_unjournaled_state');
    if(generation===session.localGeneration&&!equalSyncJson(mainBusinessState(snapshot),mainBusinessState(recovered.state)))throw new Error('storage_v2_local_file_unjournaled_normalization');
    if(!shared||!equalSyncJson(shared.state?.checks,snapshot.checks))throw new Error('storage_v2_local_file_unjournaled_checks');
    const current=await readJsonHandle(files.dataFileHandle),curMeta=current?._meta||{},curRev=Number(curMeta.revision||0);
    assertPortablePayload(current); // Reject a malformed file instead of overwriting it.
    if(curRev!==session.dbRevision){
      session.localFileConflictPending=true;
      setSaveStatus('קובץ הנתונים השתנה — השמירה לקובץ נעצרה','error');
      reportError('קובץ הנתונים השתנה מחוץ לאפליקציה. השינוי המקומי שמור ב־Storage V2 ולא ייכתב על הקובץ שהשתנה. ייצא גיבוי לפני פתיחה מחדש: פתיחת הקובץ תייבא את תוכנו ותחליף את המצב המקומי.');
      return false;
    }
    const nextRev=curRev+1,payload=payloadFromState(snapshot,nextRev);
    await writeJsonHandleVerified(files.dataFileHandle,payload);
    session.dbRevision=nextRev;session.lastSavedSnapshot=JSON.stringify(snapshot);session.serverInfo.lastSavedAt=payload._meta.savedAt;
    if(files.backupsDirHandle)await backupSnapshotToComputer(snapshot,nextRev);session.serverInfo.backups=await listBackups();
    if(generation===session.localGeneration&&!session.localFileConflictPending){setSaveStatus('נשמר בקובץ','ok');toast(msg)}else if(!session.localFileConflictPending)setSaveStatus('שומר שינוי נוסף…','saving');
    return !session.localFileConflictPending
  }catch(e){console.error(e);setSaveStatus('שגיאת שמירה לקובץ — בדוק את מצב V2','error');reportError('השמירה לקובץ נכשלה. בדוק את מצב Storage V2 ואת הגישה לתיקייה לפני ניסיון נוסף; הקובץ הקיים לא יידרס אוטומטית.');return false}
}

return {persistState};
}
