export function pdfIndexNeedsInspection(existing,fingerprint,now,{detectionRevision,searchTextRevision}){
  if(!existing||existing.fingerprint!==fingerprint)return true;
  if(existing.failed){const retryAt=Date.parse(existing.retryAfter);return !Number.isFinite(retryAt)||retryAt<=now}
  if(Number(existing.detectionRevision)<detectionRevision)return true;
  if(!existing.hasForm)return false;
  return Number(existing.searchTextRevision)<searchTextRevision;
}

export function localCheckpointDay(value){
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
  date.setDate(date.getDate()-1);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

export function pdfMaintenanceInventoryPlan({force=false,now=Date.now(),lastReconcileAt='',lastIncrementalScanAt='',reconcileIntervalMs=0}={}){
  const reconcileAt=Date.parse(String(lastReconcileAt||'')),interval=Math.max(0,Number(reconcileIntervalMs)||0);
  const full=!!force||!Number.isFinite(reconcileAt)||now-reconcileAt>=interval||!lastIncrementalScanAt;
  return {full,modifiedSince:full?'':localCheckpointDay(lastIncrementalScanAt)};
}

export function pdfMaintenanceRunLimits({manual=false,requestedMaxFiles=null,scheduledMaxFiles=300,scheduledMaxMs=15*60*1000}={}){
  const scheduledFiles=Math.max(0,Math.trunc(Number(scheduledMaxFiles)||0)),scheduledMs=Math.max(0,Math.trunc(Number(scheduledMaxMs)||0));
  const requested=requestedMaxFiles===null||requestedMaxFiles===''?NaN:Number(requestedMaxFiles),hasRequested=Number.isFinite(requested)&&requested>=0;
  return {maxChanged:hasRequested?Math.trunc(requested):(manual?Number.POSITIVE_INFINITY:scheduledFiles),maxMs:manual?0:scheduledMs};
}
