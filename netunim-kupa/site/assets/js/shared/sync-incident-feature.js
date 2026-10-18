import {clientInstanceId} from './cloud-sync.js';
import {createSyncIncidentStore} from './sync-incident-store.js';
import {createSyncIncidentRegistry} from './sync-incident-registry.js';
import {createSyncIncidentMonitor} from './sync-incident-monitor.js';
import {createSyncIncidentUi} from './sync-incident-ui.js';

// Browser resources are composed once per application. No business write waits
// for this feature, and its RPCs retain the normal authenticated API scheduler.
export function createSyncIncidentFeature({site,accountScope,subscribeAccountScope,primary,request,domains,onChange=()=>{}}){
  let ui=null;
  try{
  const raw=String(clientInstanceId()),clientId=raw.length>0&&raw.length<=160&&!/[\u0000-\u001f]/.test(raw)?raw:crypto.randomUUID();
  const labelKey='netunim.sync.device-label.v1';
  const label=()=>{try{return (localStorage.getItem(labelKey)||'').slice(0,80)}catch{return ''}};
  const registry=createSyncIncidentRegistry({request,accountScope});
  ui=createSyncIncidentUi({clientId,label,saveLabel:value=>localStorage.setItem(labelKey,value.slice(0,80)),refresh:()=>monitor.wake(),review:row=>monitor.review(row)});
  const monitor=createSyncIncidentMonitor({site,clientId,deviceLabel:label,accountScope,primary,domains,store:createSyncIncidentStore(),registry,
    visible:()=>document.visibilityState!=='hidden',publish:state=>{ui.update(state);onChange(state)}});
  const wake=()=>{void monitor.wake()},visibility=()=>{if(document.visibilityState!=='hidden')wake()};
  const unsubscribe=subscribeAccountScope(()=>{void monitor.accountChanged()});
  globalThis.addEventListener('online',wake);globalThis.addEventListener('focus',wake);globalThis.addEventListener('pageshow',wake);
  document.addEventListener('visibilitychange',visibility);
  void monitor.start();
  return {open:ui.open,get alerts(){return monitor.view.incidents.map(row=>({id:'sync:'+row.incident_id,kind:'sync_incident',...row,clientId}))},
    dispose(){unsubscribe();monitor.stop();ui.dispose();globalThis.removeEventListener('online',wake);globalThis.removeEventListener('focus',wake);globalThis.removeEventListener('pageshow',wake);document.removeEventListener('visibilitychange',visibility)}};
  }catch{
    ui?.update({status:'unavailable',incidents:[],localError:true});
    return {open(){ui?.open()},alerts:[],dispose(){ui?.dispose()}};
  }
}
