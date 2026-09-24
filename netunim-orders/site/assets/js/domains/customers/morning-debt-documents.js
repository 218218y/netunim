// A verified document belongs to the debt's history, independently of whether
// it changed the payment or invoice balance. The Morning ledger remains the
// authoritative document record after the debt itself is deleted.
export function addVerifiedMorningDebtDocument(debt,{operationId,documentId,documentNumber='',type,verifiedAt}={}){
  const operation=String(operationId||'').trim(),id=String(documentId||'').trim();
  if(!debt||!operation||!id)return false;
  const links=Array.isArray(debt.morningDocuments)?debt.morningDocuments:[];
  if(links.some(link=>link.operationId===operation))return false;
  debt.morningDocuments=[...links,{operationId:operation,documentId:id,documentNumber:String(documentNumber||''),documentType:Number(type)||0,verifiedAt:String(verifiedAt||'')}];
  return true;
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
