// The server owns matching. This owner only coalesces requests after canonical ACK.
/** @typedef {'checked'|'unchanged'|'no_bank_data'|'no_checks'|'pending'|'busy'|'unavailable'} RefreshStatus */
/** @typedef {{status:RefreshStatus,changed?:number,snapshotAt?:string,snapshotFromAt?:string}} RefreshResult */
/** @typedef {string|null|undefined} RefreshOwner */
/** @typedef {{id:string,account?:string,amount?:number|string,dueDate?:string,checkNumber?:string,
 * bankNumber?:string,branchNumber?:string,accountNumber?:string,status?:string,
 * bankAutomationDisabled?:boolean,bankReview?:string}} MatchingCheck */
/** @typedef {Pick<HTMLButtonElement,'disabled'|'textContent'>|null|undefined} RefreshButton */
/** @typedef {{owner:()=>RefreshOwner,ready:()=>boolean,checks:()=>MatchingCheck[],
 * refresh:()=>Promise<RefreshResult>,sync:()=>Promise<boolean>,render:()=>unknown,toast:(text:string)=>unknown,
 * timers?:Pick<typeof globalThis,'setTimeout'|'clearTimeout'>}} CheckBankRefreshPorts */
/** @param {CheckBankRefreshPorts} ports */
export function createCheckBankRefresh({owner,ready,checks,refresh,sync,render,toast,timers=globalThis}){
  let disposed=false,observedFingerprint='';
  /** @type {ReturnType<typeof globalThis.setTimeout>|null} */ let timer=null;
  /** @type {{owner:RefreshOwner,promise:Promise<RefreshResult>}|null} */ let flight=null;
  /** @type {RefreshOwner} */ let observedOwner='';
  const fingerprint=()=>JSON.stringify(checks().map(c=>[c.id,c.account,c.amount,c.dueDate,c.checkNumber,c.bankNumber,c.branchNumber,c.accountNumber,c.status,c.bankAutomationDisabled,c.bankReview]));
  const cancel=()=>{if(timer!==null)timers.clearTimeout(timer);timer=null};
  function observe(){
    if(disposed||!ready())return;
    if(!checks().length){cancel();observedFingerprint='';return}
    const identity=owner(),next=fingerprint();
    if(observedOwner===identity&&observedFingerprint===next)return;
    const delay=observedOwner===identity?1500:4000;
    observedOwner=identity;observedFingerprint=next;cancel();
    timer=timers.setTimeout(()=>{timer=null;void run().catch(()=>{})},delay);
  }
  /** @returns {Promise<RefreshResult>} */
  function run(){
    if(disposed||!ready())return Promise.resolve({status:'unavailable'});
    const identity=owner();
    if(flight&&flight.owner===identity)return flight.promise;
    cancel();
    const current=()=>!disposed&&owner()===identity&&ready();
    /** @returns {Promise<RefreshResult>} */
    const execute=async()=>{
      const result=await refresh();
      if(!current())return {status:'unavailable'};
      if(!['pending','busy'].includes(result.status)){
        const synced=await sync();if(!current())return {status:'unavailable'};
        if(!synced)return {...result,status:'pending'};
        cancel();observedOwner=identity;observedFingerprint=fingerprint();render();
      }
      return result;
    };
    const promise=execute();
    flight={owner:identity,promise};
    promise.finally(()=>{if(flight?.promise===promise)flight=null}).catch(()=>{});
    return promise;
  }
  /** @param {RefreshButton} button */
  async function manual(button){
    const identity=owner(),label=button?.textContent??'';
    if(button){button.disabled=true;button.textContent='בודק התאמות…'}
    try{
      const result=await run();if(disposed||owner()!==identity)return;
      let message=result.status==='no_bank_data'?'אין נתוני בנק מאומתים זמינים לבדיקה.':
        result.status==='no_checks'?'אין צ׳קים ברשימה לבדיקה.':
        result.status==='pending'?'יש שינויים בצ׳קים הממתינים לסנכרון; לא בוצעה בדיקה סופית.':
        result.status==='busy'?'בדיקת ההתאמות ממתינה לפעולת כספים פעילה. המערכת תנסה שוב אוטומטית.':
        result.status==='unavailable'?'הבדיקה זמינה בטאב הראשי לאחר התחברות וסיום טעינת הצ׳קים.':
        result.changed?`עודכנו התאמות ל־${result.changed} צ׳קים לפי נתוני הבנק השמורים.`:'ההתאמות נבדקו לפי נתוני הבנק השמורים.';
      /** @param {string} value */
      const format=value=>new Date(value).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'});
      if(result.snapshotAt)message+=result.snapshotFromAt&&result.snapshotFromAt!==result.snapshotAt
        ?` צילומי הבנק ששימשו לבדיקה: ${format(result.snapshotFromAt)} – ${format(result.snapshotAt)}.`
        :' תמונת מצב: '+format(result.snapshotAt)+'.';
      toast(message);
    }catch{if(!disposed&&owner()===identity)toast('בדיקת ההתאמות לא הושלמה. יש לוודא שהצ׳קים מסונכרנים ולנסות שוב.')}
    finally{if(button){button.disabled=false;button.textContent=label}}
  }
  return {observe,manual,run,cancel,async drain(){if(flight)await flight.promise.catch(()=>{})},dispose(){disposed=true;cancel()}};
}
