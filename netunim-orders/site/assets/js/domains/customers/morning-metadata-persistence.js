import {morningDebtDocuments,upsertVerifiedMorningDebtDocument} from './morning-debt-documents.js';

// Metadata staging stays in the existing model/journal path, so concurrent
// customer edits retain the link. Its confirmation and retry state are separate
// from provider verification and never authorize another document issuance.
export function createMorningMetadataPersistence({model,operationScope,commitSave,canMutate}){
  if(typeof commitSave!=='function')throw new TypeError('morning_metadata_commit_port_required');
  if(typeof canMutate!=='function')throw new TypeError('morning_metadata_mutation_port_required');
  const work=new WeakMap(),confirmed=new WeakMap(),states=new WeakMap();
  const entries=(map,debt)=>{if(!map.has(debt))map.set(debt,new Map());return map.get(debt)};
  const signature=(debt,operationId)=>JSON.stringify(morningDebtDocuments(debt).find(link=>link.operationId===operationId));
  const valid=entry=>{try{entry?.assertCurrent();return !!entry}catch{return false}};
  function persist(metadata={}){
    let assertCurrent;try{assertCurrent=operationScope.capture();assertCurrent()}catch{return Promise.resolve(false)}
    if(!canMutate())return Promise.resolve(false);
    const operationId=String(metadata.operationId||'').trim();if(!operationId)return Promise.resolve(false);
    if(!String(metadata.documentId||'').trim()||!String(metadata.documentNumber||'').trim()||!Number.isSafeInteger(Number(metadata.documentType))||Number(metadata.documentType)<=0||!String(metadata.verifiedAt||'').trim())return Promise.resolve(false);
    const debt=(model.state.customerDebts||[]).find(row=>morningDebtDocuments(row).some(link=>link.operationId===operationId));if(!debt)return Promise.resolve(false);
    upsertVerifiedMorningDebtDocument(debt,metadata);
    const key=signature(debt,operationId);
    const pending=entries(work,debt),known=entries(confirmed,debt),status=entries(states,debt);
    const prior=pending.get(operationId),saved=known.get(operationId);
    if(prior?.key===key&&valid(prior))return prior.promise;
    if(saved?.key===key&&valid(saved))return Promise.resolve(true);
    const current=()=>{assertCurrent();return canMutate()&&model.state.customerDebts?.find(row=>row.id===debt.id)===debt};
    const entry={key,assertCurrent,promise:null};status.set(operationId,'pending');pending.set(operationId,entry);
    entry.promise=Promise.resolve().then(async()=>{
      if(!current())return false;
      const committed=await commitSave('פרטי מסמך Morning נשמרו בחוב',{surface:'orders.morning.customerDebtMetadata',domains:['customerDebts'],operations:[{type:'put',collection:'customerDebts',id:debt.id,mode:'replace',record:debt}]});
      if(!current()||committed!==true||signature(debt,operationId)!==key)return false;
      if(pending.get(operationId)===entry)known.set(operationId,{key,assertCurrent});
      return true;
    }).finally(()=>{
      if(pending.get(operationId)!==entry)return;
      pending.delete(operationId);status.set(operationId,known.get(operationId)?.key===key&&valid(known.get(operationId))?'':'unconfirmed');
    });
    return entry.promise;
  }
  return {persist,state:(debt,operationId)=>states.get(debt)?.get(operationId)||''};
}
