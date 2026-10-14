// @ts-check

/**
 * @typedef {{snapshotToken:string, [field:string]:unknown}} BankLocalSnapshot
 * @typedef {{phase:'saving'|'unconfirmed'|'blocked',canRetry:boolean,message:string}} BankLocalSnapshotState
 * @typedef {{bank:BankLocalSnapshot,signature:string,message:string,assertCurrent:()=>void,promise:Promise<boolean>|null,confirmed:boolean}} BankLocalSnapshotEntry
 */

// A local Bank projection is distinct from Bridge availability and from a
// successful provider scrape. Retain the exact staged snapshot on save failure.
/** @param {{model:{state:{bank:Record<string,unknown>}},saveState:(message:string,options:{operations:{type:'set',field:'bank',value:BankLocalSnapshot}[]})=>unknown,recoverLocalState:(assertCurrent:()=>void)=>Promise<boolean>,render:()=>void}} ports */
export function createBankLocalSnapshot({model,saveState,recoverLocalState,render}){
  if(!model?.state||[saveState,recoverLocalState,render].some(port=>typeof port!=='function'))throw new TypeError('bank_local_snapshot_ports_required');
  /** @type {BankLocalSnapshotEntry|null} */
  let entry=null;
  const message='לא התקבל אישור שמירה לנתוני הבנק. אין לסגור את החלון; יש לבדוק את מצב השמירה המקומית.';
  const current=()=>{if(entry&&model.state.bank!==entry.bank)entry=null;return entry};
  /** @returns {BankLocalSnapshotState|null} */
  function state(){
    const value=current();if(!value)return null;
    try{value.assertCurrent()}catch(error){
      if(!scopeChanged(error))throw error;
      return {phase:'blocked',canRetry:false,message:'בעלות האחסון או החיבור המקומי השתנו; צילום הבנק לא אושר לשמירה. יש לבדוק את החיבור והאחסון תחת ההתחברות הנוכחית.'};
    }
    const unchanged=JSON.stringify(value.bank)===value.signature;
    return {phase:value.promise?'saving':'unconfirmed',canRetry:!value.promise&&unchanged,message};
  }
  /** @param {unknown} error */
  function scopeChanged(error){return !!error&&typeof error==='object'&&'code' in error&&(error.code==='FINANCE_OPERATION_SCOPE_CHANGED'||error.code==='BRIDGE_PAIRING_SCOPE_CHANGED')}
  /** @param {BankLocalSnapshotEntry} value @param {boolean} [recover] */
  function run(value,recover=false){
    value.assertCurrent();
    if(current()!==value||JSON.stringify(value.bank)!==value.signature)throw new Error('bank_local_snapshot_changed');
    if(value.promise)return value.promise;
    value.promise=Promise.resolve().then(async()=>{
      if(recover){const ready=await recoverLocalState(value.assertCurrent);value.assertCurrent();if(ready!==true)return false}
      value.assertCurrent();
      if(current()!==value||JSON.stringify(value.bank)!==value.signature)throw new Error('bank_local_snapshot_changed');
      const saved=await saveState(value.message,{operations:[{type:'set',field:'bank',value:value.bank}]});
      value.assertCurrent();
      if(saved!==true||current()!==value||JSON.stringify(value.bank)!==value.signature)return false;
      value.confirmed=true;entry=null;return true;
    }).finally(()=>{
      value.promise=null;
      // A former operation cannot render under a replacement authorization.
      try{value.assertCurrent()}catch(error){if(scopeChanged(error))return;throw error}
      if(current()===value||entry===null&&value.confirmed)render();
    });
    render();return value.promise;
  }
  /** @param {BankLocalSnapshot} bank @param {string} saveMessage @param {()=>void} assertCurrent */
  function save(bank,saveMessage,assertCurrent){
    assertCurrent();if(current())throw new Error('bank_local_snapshot_confirmation_required');
    model.state.bank=bank;
    entry={bank,signature:JSON.stringify(bank),message:saveMessage,assertCurrent,promise:null,confirmed:false};
    return run(entry);
  }
  function retry(){const value=current();return value?run(value,true):Promise.resolve(false)}
  return {save,retry,state};
}
