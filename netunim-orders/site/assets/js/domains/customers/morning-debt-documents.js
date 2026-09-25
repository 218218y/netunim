// A verified document belongs to the debt's history, independently of whether
// it changed the payment or invoice balance. The Morning ledger remains the
// authoritative document record after the debt itself is deleted.
function normalizedVerifiedDocument({operationId,documentId,documentNumber='',documentType,type,verifiedAt}={}){
  const operation=String(operationId||'').trim(),id=String(documentId||'').trim();
  if(!operation||!id)return null;
  return {operationId:operation,documentId:id,documentNumber:String(documentNumber||''),documentType:Number(documentType??type)||0,verifiedAt:String(verifiedAt||'')};
}

export function upsertVerifiedMorningDebtDocument(debt,value={}){
  const next=normalizedVerifiedDocument(value);if(!debt||!next)return false;
  const links=Array.isArray(debt.morningDocuments)?debt.morningDocuments:[],index=links.findIndex(link=>link?.operationId===next.operationId);
  if(index<0){debt.morningDocuments=[...links,next];return true}
  const current=links[index]||{},merged={...current,...next};
  if(current.documentId===merged.documentId&&current.documentNumber===merged.documentNumber&&Number(current.documentType)===merged.documentType&&String(current.verifiedAt||'')===merged.verifiedAt)return false;
  debt.morningDocuments=links.map((link,rowIndex)=>rowIndex===index?merged:link);return true;
}

export function addVerifiedMorningDebtDocument(debt,{operationId,documentId,documentNumber='',type,verifiedAt}={}){
  return upsertVerifiedMorningDebtDocument(debt,{operationId,documentId,documentNumber,documentType:type,verifiedAt});
}

export function morningDebtDocuments(debt){
  const links=Array.isArray(debt?.morningDocuments)?debt.morningDocuments.slice():[],known=new Set(links.map(link=>link.operationId));
  // Older debts recorded the verified operation on the movement but did not
  // retain the document ID. Resolve those IDs from the owned Morning ledger on click.
  for(const entry of Array.isArray(debt?.debtProgress)?debt.debtProgress:[]){
    if(entry?.source!=='morning')continue;
    const operation=/^MORNING:([^:]+):(payment|invoice)$/.exec(String(entry.id||''))?.[1];
    if(!operation||known.has(operation))continue;
    known.add(operation);links.push({operationId:operation,documentId:'',documentNumber:'',documentType:0,verifiedAt:String(entry.createdAt||'')});
  }
  return links;
}
