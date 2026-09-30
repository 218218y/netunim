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
