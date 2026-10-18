// Injected into disposable browser copies only; never shipped as an app asset.
// Keep the real registry codec/lifecycle, replacing only unrelated service I/O.
const fixtureIncidents=new Map();
const registry=createSyncIncidentRegistry({accountScope,request:async(path,options)=>{
  const name=path.split('/').at(-1),body=JSON.parse(options.body),at=new Date().toISOString();
  if(name==='list_active_sync_incidents_v1')return new Response(JSON.stringify([...fixtureIncidents.values()].filter(row=>row.owner_id===accountScope().owner&&row.resolved_at===null)));
  if(name==='mark_sync_incident_reviewed_v1'){
    const row=fixtureIncidents.get(accountScope().owner+':'+body.p_incident_id);
    if(!row||row.owner_id!==accountScope().owner||row.report_version!==body.p_expected_report_version)return new Response('{}',{status:409});
    row.resolved_at=at;row.resolution_kind='operator_reviewed_unverified';return new Response(JSON.stringify(row));
  }
  const incident=body.p_incident,key=accountScope().owner+':'+incident.incident_id;
  let row=fixtureIncidents.get(key);
  if(!row||row.resolved_at===null&&row.report_version<incident.report_version){
    row={...incident,owner_id:accountScope().owner,first_reported_at:row?.first_reported_at||at,last_reported_at:at,resolved_at:null,resolution_kind:null};
    if(name==='resolve_sync_incident_v1'){row.resolved_at=at;row.resolution_kind='clean_verified'}
    fixtureIncidents.set(key,row);
  }
  return new Response(JSON.stringify(row));
}});
