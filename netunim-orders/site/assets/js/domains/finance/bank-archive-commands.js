// Local archive publication follows the current account's server receipt.
export function createBankArchiveCommands({operationScope,transport,archive,toast}){
const {saveBankTransactionHandled,acknowledgeBankTransactionMissing,acknowledgeBankTransactionAlert}=transport;
const updateLocalBankTransaction=archive.update;
  async function toggleBankTransactionHandled(transactionId,handled){
    const id=Number(transactionId);if(!Number.isSafeInteger(id)||id<=0){toast('לא ניתן לזהות את תנועת הבנק');return false}
    try{const assertCurrent=operationScope.capture(),result=await saveBankTransactionHandled(id,handled===true,{assertCurrent});assertCurrent();const at=result?.handled_at||result?.handledAt||null;updateLocalBankTransaction(id,row=>{row.handledAt=at});return true}catch(error){toast(error?.message||'עדכון מצב תנועת הבנק נכשל');return false}
  }
  function markBankMorningVerified(transactionId,bankLink={}){
    const id=Number(transactionId);if(!Number.isSafeInteger(id)||id<=0)return false;const link=bankLink&&typeof bankLink==='object'?bankLink:{handledAt:bankLink},changed=updateLocalBankTransaction(id,row=>{row.handledAt=row.handledAt||link.handledAt||null;const documentId=String(link.documentId||'').trim(),operationId=String(link.operationId||'').trim();if(documentId||operationId){const current=Array.isArray(row.documentLinks)?row.documentLinks:[],key=item=>String(item?.documentId||item?.operationId||'').trim(),needle=documentId||operationId,entry={linkId:Number(link.linkId)||null,operationId,documentId,documentNumber:String(link.documentNumber||''),documentType:Number(link.documentType)||0,documentAmount:Number(link.documentAmount)||0,verifiedAt:link.verifiedAt||new Date().toISOString()};row.documentLinks=[entry,...current.filter(item=>key(item)!==needle)].slice(0,50)}});return changed;
  }

  async function acknowledgeMissingBankTransaction(transactionId){
    const id=Number(transactionId);if(!Number.isSafeInteger(id)||id<=0){toast('לא ניתן לזהות את תנועת הבנק לסימון');return false}
    try{const assertCurrent=operationScope.capture(),result=await acknowledgeBankTransactionMissing(id,{assertCurrent});assertCurrent();const at=String(result?.acknowledged_at||result?.acknowledgedAt||new Date().toISOString());updateLocalBankTransaction(id,row=>{row.missingAcknowledgedAt=at});toast('התנועה סומנה כנבדקה. התיעוד נשמר בארכיון, והיא הוסרה מההיסטוריה החכמה ומהאזהרות.');return true}catch(error){toast(error?.message||'סימון התנועה כנבדקה נכשל');return false}
  }

  async function acknowledgePersistentBankAlert(transactionId,alertKind){
    const id=Number(transactionId),kind=String(alertKind||'').trim();
    if(!Number.isSafeInteger(id)||id<=0||kind!=='returned_cheque'){toast('לא ניתן לזהות את התראת הבנק להסרה');return false}
    try{const assertCurrent=operationScope.capture(),result=await acknowledgeBankTransactionAlert(id,kind,{assertCurrent});assertCurrent();const at=String(result?.acknowledged_at||result?.acknowledgedAt||new Date().toISOString());updateLocalBankTransaction(id,row=>{row.alertAcknowledgements={...(row.alertAcknowledgements&&typeof row.alertAcknowledgements==='object'?row.alertAcknowledgements:{}),[kind]:at}});toast('ההתראה הוסרה ולא תוצג שוב עבור אירוע הבנק הזה.');return true}catch(error){toast(error?.message||'הסרת התראת הבנק נכשלה');return false}
  }

return {toggleBankTransactionHandled,markBankMorningVerified,acknowledgeMissingBankTransaction,acknowledgePersistentBankAlert};
}
