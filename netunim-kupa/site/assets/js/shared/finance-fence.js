export function financeFencePayload(lease){return {p_lease_name:lease?.leaseName??null,p_lease_token:lease?.leaseToken??null,p_fence_epoch:lease?.fenceEpoch??null}}

// An operation owns authorization and publication, independently of the
// scheduler's enabled/online state. Stopping a timer does not revoke a commit.
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
  function capture(readOnly=false){
    const observed=observe(readOnly);
    return ()=>{const live=observe(readOnly);if(Object.keys(observed).some(key=>live[key]!==observed[key]))throw failure()};
  }
  return {capture:()=>capture(),captureRead:()=>capture(true)};
}

// Manual changes share the issuer lease but do not start an issuer login. Queue
// local edits and allow an in-flight cross-app publication time to release it.
// Read/rebase the mutation only AFTER acquiring the lease; never reuse a draft
// of the entire finance document captured while waiting.
export function createFinanceManualQueue({claim,release,createToken,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxWaitMs=30000,retryMs=1000,onReleaseError=error=>console.error('manual finance lease release',error)}){
  let tail=Promise.resolve();
  return (work,{assertCurrent}={})=>{
    const run=async()=>{
      const token=createToken();let lease,waited=0;
      const scopeOptions=assertCurrent?[{assertCurrent}]:[];
      for(;;){
        assertCurrent?.();lease=await claim('credit',token,...scopeOptions);
        if(lease?.acquired)break;
        assertCurrent?.();
        if(waited>=maxWaitMs)throw Object.assign(new Error('סנכרון אשראי אחר עדיין פעיל. השינוי לא נשמר; ניתן לנסות שוב לאחר סיום הסנכרון.'),{code:'finance_sync_lease_busy'});
        const delay=Math.min(retryMs,maxWaitMs-waited);await wait(delay);waited+=delay;
      }
      // Scope loss deliberately leaves the former account's lease to expire.
      try{assertCurrent?.();return await work(assertCurrent?{...lease,assertCurrent}:lease)}finally{try{assertCurrent?.();await release('credit',token,...scopeOptions)}catch(error){if(error.code!=='FINANCE_OPERATION_SCOPE_CHANGED')onReleaseError(error)}}
    };
    const result=tail.then(run,run);tail=result.catch(()=>{});return result;
  };
}
