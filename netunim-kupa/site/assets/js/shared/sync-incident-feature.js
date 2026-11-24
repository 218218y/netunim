import {clientInstanceId} from './cloud-sync.js';
import {createSyncIncidentStore} from './sync-incident-store.js';
import {createSyncIncidentRegistry} from './sync-incident-registry.js';
import {createSyncIncidentMonitor} from './sync-incident-monitor.js';
import {createSyncIncidentUi} from './sync-incident-ui.js';
import {syncIncidentDescription} from './sync-incident-model.js';
import {createMorningOperationCenter} from './morning-operation-center.js';

// Browser resources are composed once per application. No business write waits
// for this feature, and its RPCs retain the normal authenticated API scheduler.
export function createSyncIncidentFeature({site,accountScope,subscribeAccountScope,primary,request,domains,morning={},confirmReview=async()=>false,onChange=()=>{}}){
  let ui=null,settingsUi=null;
  try{
  const raw=String(clientInstanceId()),clientId=raw.length>0&&raw.length<=160&&!/[\u0000-\u001f]/.test(raw)?raw:crypto.randomUUID();
  const labelKey='netunim.sync.device-label.v1';
  const label=()=>{try{return (localStorage.getItem(labelKey)||'').slice(0,80)}catch{return ''}};
  const registry=createSyncIncidentRegistry({request,accountScope});
  const publish=(state,force=false)=>{ui?.update(state,force);settingsUi?.update(state,force);onChange(state)};
  const financial=createMorningOperationCenter({request,accountScope,...morning,publish:()=>publish(monitor.view,true)});
  const listIncidents=registry.list;
  registry.list=scope=>{void financial.refresh();return listIncidents(scope)};
  const uiOptions={clientId,label,financial,saveLabel:value=>{localStorage.setItem(labelKey,value.slice(0,80));publish(monitor.view)},
    refresh:()=>Promise.all([monitor.wake(),financial.refresh({force:true})]),review:row=>monitor.review(row),confirmReview};
  ui=createSyncIncidentUi(uiOptions);
  const monitor=createSyncIncidentMonitor({site,clientId,deviceLabel:label,accountScope,primary,domains,store:createSyncIncidentStore(),registry,
    visible:()=>document.visibilityState!=='hidden',publish});
  const wake=()=>{void monitor.wake()},visibility=()=>{if(document.visibilityState!=='hidden')wake()};
  const unsubscribe=subscribeAccountScope(()=>{financial.syncScope();void monitor.accountChanged()});
  const online=()=>{void financial.refresh({force:true});wake()};
  globalThis.addEventListener('online',online);globalThis.addEventListener('focus',wake);globalThis.addEventListener('pageshow',wake);
  document.addEventListener('visibilitychange',visibility);
  const labelChanged=event=>{if(event.storageArea===localStorage&&(event.key===labelKey||event.key===null)){publish(monitor.view);wake()}};
  globalThis.addEventListener('storage',labelChanged);
  void monitor.start();
  return {open:ui.open,get alerts(){return monitor.view.incidents.map(row=>({id:'sync:'+row.incident_id,kind:'sync_incident',...row,description:syncIncidentDescription(row,clientId)}))},
    mountSettings(container){settingsUi?.dispose();container.replaceChildren();settingsUi=createSyncIncidentUi({...uiOptions,container,inline:true});settingsUi.update(monitor.view)},
    dispose(){unsubscribe();financial.dispose();monitor.stop();ui.dispose();settingsUi?.dispose();globalThis.removeEventListener('storage',labelChanged);globalThis.removeEventListener('online',online);globalThis.removeEventListener('focus',wake);globalThis.removeEventListener('pageshow',wake);document.removeEventListener('visibilitychange',visibility)}};
  }catch{
    ui?.update({status:'unavailable',incidents:[],localError:true});
    return {open(){ui?.open()},mountSettings(container){container.textContent='לא ניתן לטעון התראות סנכרון. יש לרענן את האתר.'},alerts:[],dispose(){ui?.dispose();settingsUi?.dispose()}};
  }
}
