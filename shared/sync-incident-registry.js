import {SYNC_INCIDENT_DOMAINS} from './sync-incident-model.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function decodeSyncIncident(row,owner){
  if(!row||row.owner_id!==owner||!uuid.test(row.incident_id)||!SYNC_INCIDENT_DOMAINS.includes(row.domain)||!['orders','kupa'].includes(row.site)
    ||row.domain!=='shared_checks'&&!row.domain.startsWith(row.site+'_')
    ||!['warning','critical'].includes(row.severity)||!['stalled','conflict','recovery_blocked','local_durability_error'].includes(row.reason_code)
    ||!['journal','spreadsheet','calendar_queue','durability','unknown'].includes(row.evidence_kind)
    ||typeof row.has_pending!=='boolean'||!Number.isSafeInteger(row.report_version)||row.report_version<1
    ||typeof row.client_instance_id!=='string'||!row.client_instance_id||row.client_instance_id.length>160
    ||typeof row.device_label!=='string'||row.device_label.length>80||typeof row.scope_epoch!=='string'||!row.scope_epoch||row.scope_epoch.length>160
    ||typeof row.last_error_code!=='string'||row.last_error_code.length>100
    ||!Number.isFinite(Date.parse(row.first_reported_at))||!Number.isFinite(Date.parse(row.last_reported_at))
    ||(row.resolved_at===null?row.resolution_kind!==null:!Number.isFinite(Date.parse(row.resolved_at))||!['clean_verified','operator_reviewed_unverified'].includes(row.resolution_kind)))throw new Error('sync_incident_response_invalid');
  return structuredClone(row);
}
export function createSyncIncidentRegistry({request,accountScope}){
  async function rpc(name,body,scope){
    const assertCurrent=()=>{const live=accountScope();if(!live.owner||live.owner!==scope.owner||live.epoch!==scope.epoch)throw new Error('sync_incident_account_changed')};
    assertCurrent();
    const response=await request('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(body),dataPriority:'low',networkRetry:false,assertRequestScope:assertCurrent});
    assertCurrent();if(!response.ok)throw new Error('sync_incident_rpc_'+response.status);
    const value=await response.json();assertCurrent();return value;
  }
  async function write(name,incident,scope){
    const row=decodeSyncIncident(await rpc(name,{p_incident:incident},scope),scope.owner);
    for(const key of ['incident_id','client_instance_id','site','domain','scope_epoch'])if(row[key]!==incident[key])throw new Error('sync_incident_receipt_mismatch');
    if(row.report_version<incident.report_version&&row.resolved_at===null)throw new Error('sync_incident_receipt_stale');
    if(name==='resolve_sync_incident_v1'&&row.resolved_at===null)throw new Error('sync_incident_resolution_unconfirmed');
    return row;
  }
  return {
    report:(value,scope)=>write('report_sync_incident_v1',value,scope),
    resolve:(value,scope)=>write('resolve_sync_incident_v1',value,scope),
    async list(scope){const rows=await rpc('list_active_sync_incidents_v1',{},scope);if(!Array.isArray(rows))throw new Error('sync_incident_list_invalid');const ids=new Set();return rows.map(row=>{const value=decodeSyncIncident(row,scope.owner);if(value.resolved_at!==null||ids.has(value.incident_id))throw new Error('sync_incident_list_invalid');ids.add(value.incident_id);return value})},
    async review(row,scope){const receipt=decodeSyncIncident(await rpc('mark_sync_incident_reviewed_v1',{p_incident_id:row.incident_id,p_expected_report_version:row.report_version},scope),scope.owner);if(receipt.incident_id!==row.incident_id||receipt.resolution_kind!=='operator_reviewed_unverified')throw new Error('sync_incident_review_unconfirmed');return receipt},
  };
}
