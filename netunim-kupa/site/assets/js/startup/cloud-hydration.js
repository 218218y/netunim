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
    ['status',status,['setCloudHeaderStatus','setConnectUI']],
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
  const canHydrate=()=>access.allowed()&&access.online()&&access.authenticated();
  const hydrate=createStartupTask(async()=>{
    if(!plan)throw new Error('kupa_startup_plan_required');
    try{
      if(plan.localEngineActive)return 'local';
      if(!access.allowed())return 'blocked';
      if(!access.online()){cloud.startPolling();return 'offline'}
      if(!access.authenticated()){status.setCloudHeaderStatus('off','ענן: נדרשת התחברות');return 'signed-out'}
      session.startupCloudHydrating=true;
      try{await capabilities.ensure();session.syncCapabilitiesError=null}
      catch(error){
        session.syncCapabilitiesError=error;
        status.setCloudHeaderStatus('conflict',error.message);
        status.setConnectUI({title:'ה־DB אינו תואם לגרסת האתר',text:error.message,showCloud:false});
        return 'capability-failure';
      }
      if(!canHydrate())return 'deferred';
      // Keep the existing restore reconciliation failure policy. Changing its
      // classification requires a separate protocol/restore review.
      try{await restore.resume()}
      catch(error){console.error('restore group startup recovery',error);status.setCloudHeaderStatus('conflict','ענן: שחזור ממתין')}
      if(!canHydrate())return 'deferred';
      if(await cloud.openAutomatic())return 'opened';
      if(!canHydrate())return 'deferred';
      if(cloud.noDocument()){await cloud.showNoDocument();return 'no-document'}
      return 'unavailable';
    }finally{session.startupCloudHydrating=false}
  });
  return {prepare,hydrate};
}
