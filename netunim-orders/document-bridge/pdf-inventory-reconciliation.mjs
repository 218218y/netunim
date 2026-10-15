import {pdfIndexNeedsInspection} from './pdf-index-policy.mjs';

// Only a complete verified full inventory may remove derived cached entries.
// An accepted journal append drains before a late stop blocks backlog success.
export function createPdfInventoryReconciliation({inventory,index,policy,clock=Date}){
const pdfInventory=inventory,pdfFormIndex=index.entries,pdfIndexKey=index.key,pdfIndexFingerprint=index.fingerprint;
const listEverythingPdfs=options=>inventory.read(options),appendPdfIndexJournal=records=>index.append(records);
const {PDF_FORM_DETECTION_REVISION,PDF_FORM_SEARCH_TEXT_REVISION}=policy;
async function rebuildPdfFormIndexBacklog({signal=null,full=false,modifiedSince=''}={}){
  const rows=await listEverythingPdfs({signal,modifiedSince:full?'':modifiedSince,verifyComplete:full});
  pdfInventory.assertActive(signal);
  const seen=new Set(),changed=[];let removed=0;
  for(const row of rows){
    const key=pdfIndexKey(row.fullPath),fingerprint=pdfIndexFingerprint(row);seen.add(key);
    const existing=pdfFormIndex.get(key);if(!pdfIndexNeedsInspection(existing,fingerprint,clock.now(),{detectionRevision:PDF_FORM_DETECTION_REVISION,searchTextRevision:PDF_FORM_SEARCH_TEXT_REVISION}))continue;
    changed.push({...row,fingerprint});
  }
  if(!full)for(const entry of pdfFormIndex.values())if(entry.failed&&!seen.has(pdfIndexKey(entry.fullPath))&&pdfIndexNeedsInspection(entry,entry.fingerprint,clock.now(),{detectionRevision:PDF_FORM_DETECTION_REVISION,searchTextRevision:PDF_FORM_SEARCH_TEXT_REVISION}))changed.push({...entry});
  changed.sort((a,b)=>(Date.parse(b.modified)||0)-(Date.parse(a.modified)||0)||a.fullPath.localeCompare(b.fullPath));
  const removalRecords=[];
  if(full){
    if(pdfFormIndex.size>100&&rows.length<pdfFormIndex.size/2)throw new Error(`PDF inventory unexpectedly shrank from ${pdfFormIndex.size} to ${rows.length}; keeping cached entries`);
    for(const [key,entry] of [...pdfFormIndex.entries()])if(!seen.has(key)){removalRecords.push({op:'remove',fullPath:entry.fullPath});removed+=1}
  }
  if(removalRecords.length)await appendPdfIndexJournal(removalRecords);
  pdfInventory.assertActive(signal);
  index.publish({pending:changed.length,pdfCount:full?rows.length:index.view().pdfCount});
  return {pdfCount:rows.length,changed:changed.length,removed,rows:changed};
}
return {rebuild:rebuildPdfFormIndexBacklog};
}
