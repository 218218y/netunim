import {createStartupTask} from '../shared/startup-task.js';

// Owns startup cloud eligibility and the hydration write gate. Access is read
// again between effects; the session restored during preflight is not authority
// for later requests. In-flight journal/restore operations retain their fences.
export function createKupaCloudStartup({session,access,capabilities,restore,cloud,status}){
  if(!session)throw new TypeError('kupa_cloud_startup_session_required');
  for(const [name,port,methods] of [
    ['access',access,['allowed','online','authenticated']],
    ['capabilities',capabilities,['ensure']],['restore',restore,['resume']],
    ['cloud',cloud,['configured','openAutomatic','noDocument','showNoDocument','startPolling']],
    ['status',status,['setCloudHeaderStatus','setSaveStatus','setConnectUI']],
  ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`kupa_startup_${name}_${method}_required`);
  let plan=null,preparation=null,preparedMode=null;
  function prepare({localEngineActive}){
    if(typeof localEngineActive!=='boolean')throw new TypeError('kupa_startup_mode_required');
    if(preparation){if(preparedMode!==localEngineActive)throw new Error('kupa_startup_mode_changed');return preparation}
    preparedMode=localEngineActive;
    preparation=Promise.resolve().then(()=>{
      session.startupCloudHydrating=!localEngineActive&&access.online();
      if(cloud.configured())status.setCloudHeaderStatus('syncing',session.startupCloudHydrating?'ענן: מסנכרן…':'ענן: בודק…');
      else status.setCloudHeaderStatus('off','ענן: לא מוגדר');
      plan=Object.freeze({localEngineActive});return plan;
    });
    return preparation;
  }
  function hydrationBlocked(){
    if(!access.allowed())return 'blocked';
    const online=access.online();
    if(online&&access.authenticated())return null;
    const pending=session.storageV2CloudPending;
    status.setCloudHeaderStatus(online?'off':'offline',online?'ענן: נדרשת התחברות':'ענן: אופליין');
    const local=pending?'שינוי שמור מקומית · ממתין לסנכרון':'מקומי: מוצג העותק האחרון';
    status.setSaveStatus(local,'saving');
    return online?'signed-out':'offline';
  }
  const hydrate=createStartupTask(async()=>{
    if(!plan)throw new Error('kupa_startup_plan_required');
    try{
      if(plan.localEngineActive)return 'local';
      const blocked=hydrationBlocked();
      if(blocked==='offline')cloud.startPolling();
      if(blocked)return blocked;
      session.startupCloudHydrating=true;
      try{await capabilities.ensure();session.syncCapabilitiesError=null}
      catch(error){
        session.syncCapabilitiesError=error;
        status.setCloudHeaderStatus('conflict',error.message);
        status.setConnectUI({title:'ה־DB אינו תואם לגרסת האתר',text:error.message,showCloud:false});
        return 'capability-failure';
      }
      if(hydrationBlocked())return 'deferred';
      // An unknown restore outcome cannot release normal editing on an old head.
      try{await restore.resume()}
      catch(error){console.error('restore group startup recovery',error);status.setCloudHeaderStatus('conflict','ענן: שחזור ממתין');session.storageProtocolBlocked=true;throw error}
      if(hydrationBlocked())return 'deferred';
      if(await cloud.openAutomatic())return 'opened';
      if(hydrationBlocked())return 'deferred';
      if(cloud.noDocument()){await cloud.showNoDocument();return 'no-document'}
      return 'unavailable';
    }finally{session.startupCloudHydrating=false}
  });
  return {prepare,hydrate};
}
