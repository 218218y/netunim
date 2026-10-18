export const SYNC_INCIDENT_GRACE_MS=90_000;
export const SYNC_INCIDENT_DOMAINS=Object.freeze(['orders_main','kupa_main','shared_checks','orders_sheet','kupa_sheet','orders_calendar']);
const domainLabels={orders_main:'נתוני הזמנות',kupa_main:'נתוני קופה',shared_checks:'צ׳קים משותפים',orders_sheet:'גיליונות הזמנות',kupa_sheet:'גיליונות קופה',orders_calendar:'יומן Google'};
const reasonLabels={stalled:'שינויים ממתינים ללא אישור סנכרון',conflict:'התנגשות שדורשת בדיקה',recovery_blocked:'התאוששות הסנכרון נעצרה',local_durability_error:'לא ניתן לאמת שמירה מקומית עמידה'};
export function syncIncidentDescription(row,clientId){
  return `${row.device_label||'עמדה ללא שם'} · ${row.client_instance_id===clientId?'התקנה זו':'התקנה אחרת'} · ${row.site==='orders'?'הזמנות':'קופה'} · ${domainLabels[row.domain]} · ${reasonLabels[row.reason_code]}`;
}

// Unknown is deliberately different from a verified empty outbox.
export function classifySyncIncident(sample,{pendingSince=null,now=Date.now(),graceMs=SYNC_INCIDENT_GRACE_MS}={}){
  if(sample?.durabilityError)return {state:'local_durability_error',severity:'critical',reason:'local_durability_error'};
  if(sample?.blocked)return {state:'blocked',severity:'critical',reason:sample.conflict?'conflict':'recovery_blocked'};
  if(!sample||sample.known!==true)return {state:'unknown'};
  if(sample.pending){
    if(sample.failures>=2||pendingSince!==null&&now-pendingSince>=graceMs)return {state:'stalled',severity:'warning',reason:'stalled'};
    return {state:'pending_grace'};
  }
  return {state:sample.verified===true?'clean_verified':'unknown'};
}

export function journalIncidentSample(cloud,{durabilityError=false,current=()=>true}={}){
  const base=cloud?.base,valid=Number.isSafeInteger(cloud?.seq)&&cloud.seq>=0&&Number.isSafeInteger(base?.ackSeq)&&base.ackSeq>=0&&base.ackSeq<=cloud.seq&&Number.isSafeInteger(base?.revision)&&base.revision>=0&&typeof base?.epoch==='string'&&base.epoch.length>0;
  return {known:valid,pending:!!(cloud?.pending||cloud?.flight||valid&&cloud.seq>base.ackSeq),
    blocked:!!cloud?.control?.conflict,conflict:!!cloud?.control?.conflict,durabilityError,
    verified:valid&&cloud.seq===base.ackSeq&&!cloud.pending&&!cloud.flight&&!cloud.control&&!durabilityError,
    failures:Number(cloud?.control?.retry?.attempts||0),errorCode:String(cloud?.control?.retry?.lastErrorCode||''),
    epoch:base?.epoch||'unavailable',evidence:durabilityError?'durability':'journal',isCurrent:current};
}
