export const MIN_SYNC_CAPABILITIES=Object.freeze({documentOperationLedger:3,syncIntegrity:5,deleteIntents:4,massDeleteGuard:5,restoreGroups:5,sharedChecksIntegrity:5,financeFencing:1});
export function createSyncCapabilityGate(read){
  let promise=null,compatible=false;
  return {ready:()=>compatible,reset(){promise=null;compatible=false},async ensure(){
    if(compatible)return true;
    if(!promise)promise=(async()=>{const actual=await read(),missing=Object.entries(MIN_SYNC_CAPABILITIES).filter(([key,minimum])=>!Number.isInteger(actual?.[key])||actual[key]<minimum).map(([key])=>key);if(missing.length){const error=new Error('ה־DB אינו תואם לגרסת האתר. נדרש עדכון מסד הנתונים; המערכת במצב קריאה בלבד.');error.code='netunim_sync_capabilities_missing';error.missing=missing;throw error}compatible=true;return true})().finally(()=>{promise=null});
    return promise;
  }};
}
export function syncRequestNeedsCapabilities(path,method){return /^\/rest\/v1(?:\/|\?|$)/.test(path)&&!['GET','HEAD'].includes(String(method||'GET').toUpperCase())&&!/^\/rest\/v1\/rpc\/(get_netunim_sync_capabilities|list_incomplete_restore_groups_v5)$/.test(path)}
