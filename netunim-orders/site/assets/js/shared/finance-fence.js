// @ts-check
/** @typedef {()=>undefined} FinanceGuard */
/** @typedef {Readonly<{acquired:true,leaseName:'credit',leaseToken:string,fenceEpoch:number,localOnly?:false}>|Readonly<{acquired:true,localOnly:true}>} ManualGrant */
/** @typedef {ManualGrant & {assertCurrent?:FinanceGuard}} ManualLease */
/** @typedef {{connectionMode:string,storageOwner:string|null,account?:{owner?:string|null,epoch?:string|number|null}|null,readable:boolean,writable:boolean}} FinanceAccess */
/** @typedef {{leaseName?:'bank'|'credit',leaseToken?:string,fenceEpoch?:number,localOnly?:boolean,assertCurrent?:FinanceGuard}} FenceLease */
/** @param {FenceLease|null|undefined} lease */
export function financeFencePayload(lease){return {p_lease_name:lease?.leaseName??null,p_lease_token:lease?.leaseToken??null,p_fence_epoch:lease?.fenceEpoch??null}}
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {unknown} error */
function scopeChanged(error){return object(error)&&error.code==='FINANCE_OPERATION_SCOPE_CHANGED'}

// An operation owns authorization and publication, independently of the
// scheduler's enabled/online state. Stopping a timer does not revoke a commit.
/** @param {{readAccess:()=>FinanceAccess}} ports */
export function createFinanceOperationScope({readAccess}){
  if(typeof readAccess!=='function')throw new Error('finance_operation_access_required');
  const failure=()=>Object.assign(new Error('ההתחברות או בעלות האחסון השתנתה במהלך הסנכרון. הנתונים הקודמים נשמרו; יש להתחבר ולרענן שוב.'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});
  function observe(readOnly=false){
    const value=readAccess();
    if(!(readOnly?value?.readable:value?.writable)||!value.storageOwner||!value.connectionMode)throw failure();
    const accountOwner=value.account?.owner??null,accountEpoch=value.account?.epoch??null;
    if((value.connectionMode==='supabase'||value.storageOwner!=='local')&&(!accountOwner||accountOwner!==value.storageOwner))throw failure();
    return {connectionMode:value.connectionMode,storageOwner:value.storageOwner,accountOwner,accountEpoch};
  }
  /** @param {boolean} [readOnly] @returns {FinanceGuard} */
  function capture(readOnly=false){
    const observed=observe(readOnly);
    return ()=>{const live=observe(readOnly);if(Object.keys(observed).some(key=>live[/** @type {keyof typeof observed} */ (key)]!==observed[/** @type {keyof typeof observed} */ (key)]))throw failure()};
  }
  return {capture:()=>capture(),captureRead:()=>capture(true)};
}

/**
 * A refusal authorizes waiting only. Manual work needs the exact requested
 * credit token and a safe server fence, or an explicit trusted local grant.
 * This capability result is independent of any document write confirmation.
 * @param {unknown} value @param {string} token
 * @returns {ManualGrant|Readonly<{acquired:false}>}
 */
export function readManualFinanceGrant(value,token){
  if(object(value)&&value.acquired===false)return Object.freeze({acquired:false});
  if(object(value)&&value.acquired===true){
    if(value.localOnly===true&&value.leaseName===undefined&&value.leaseToken===undefined&&value.fenceEpoch===undefined)return Object.freeze({acquired:true,localOnly:true});
    if(value.localOnly===undefined||value.localOnly===false){
      const {leaseName,leaseToken,fenceEpoch}=value;
      if(leaseName==='credit'&&leaseToken===token&&typeof leaseToken==='string'&&!!leaseToken.trim()&&leaseToken.length<=200&&typeof fenceEpoch==='number'&&Number.isSafeInteger(fenceEpoch)&&fenceEpoch>0)
        return Object.freeze({acquired:true,leaseName,leaseToken,fenceEpoch});
    }
  }
  throw Object.assign(new Error('לא התקבלה ראיית נעילה תקינה לשינוי הפיננסי. השינוי לא נשמר.'),{code:'FINANCE_MANUAL_LEASE_INVALID',kind:'confirmation_unknown',retryable:false});
}

/** @typedef {{claim:(name:'credit',token:string,options?:{assertCurrent:FinanceGuard})=>Promise<unknown>,release:(name:'credit',token:string,options?:{assertCurrent:FinanceGuard})=>Promise<unknown>,createToken:()=>string,wait?:(ms:number)=>Promise<unknown>,maxWaitMs?:number,retryMs?:number,onReleaseError?:(error:unknown)=>void}} ManualQueuePorts */
/** @typedef {<T>(work:(lease:ManualLease)=>T|Promise<T>,options?:{assertCurrent?:FinanceGuard})=>Promise<T>} ManualQueue */
// Read/rebase the mutation only AFTER acquiring the lease; never reuse a draft
// captured while waiting. Cleanup cannot borrow a replacement login's authority.
/** @param {ManualQueuePorts} ports @returns {ManualQueue} */
export function createFinanceManualQueue({claim,release,createToken,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxWaitMs=30000,retryMs=1000,onReleaseError=error=>console.error('manual finance lease release',error)}){
  if(!Number.isFinite(maxWaitMs)||maxWaitMs<0||!Number.isFinite(retryMs)||retryMs<=0)throw new TypeError('finance_manual_wait_policy_invalid');
  /** @type {Promise<unknown>} */ let tail=Promise.resolve();
  /** @type {ManualQueue} */
  const enqueue=(work,{assertCurrent}={})=>{
    const run=async()=>{
      const token=createToken();if(typeof token!=='string'||!token.trim()||token.length>200)throw new TypeError('finance_manual_token_invalid');
      /** @type {ReturnType<typeof readManualFinanceGrant>} */ let lease;
      let waited=0;
      const scopeOptions=assertCurrent?{assertCurrent}:undefined;
      for(;;){
        assertCurrent?.();
        /** @type {unknown} */ let value;
        try{value=await claim('credit',token,scopeOptions)}catch(error){assertCurrent?.();throw error}
        assertCurrent?.();lease=readManualFinanceGrant(value,token);
        if(lease.acquired===true)break;
        if(waited>=maxWaitMs)throw Object.assign(new Error('סנכרון אשראי אחר עדיין פעיל. השינוי לא נשמר; ניתן לנסות שוב לאחר סיום הסנכרון.'),{code:'finance_sync_lease_busy'});
        const delay=Math.min(retryMs,maxWaitMs-waited);await wait(delay);waited+=delay;
      }
      try{assertCurrent?.();return await work(assertCurrent?Object.freeze({...lease,assertCurrent}):lease)}finally{try{assertCurrent?.();await release('credit',token,scopeOptions)}catch(error){if(!scopeChanged(error))onReleaseError(error)}}
    };
    const result=tail.then(run,run);tail=result.catch(()=>{});return result;
  };
  return enqueue;
}
