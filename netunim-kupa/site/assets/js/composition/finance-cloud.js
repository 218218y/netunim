// The bank and credit controllers share one cloud freshness and lease policy.
// Keep its mutable lease set scoped to a single app runtime.
export function createKupaFinanceCloudPorts({
  model,session,cloudTransport,syncDocument,
  isOnline=()=>navigator.onLine,
  reportError=error=>console.error('finance cloud freshness',error),
}){
  const remoteLeaseTokens=new Set();

  async function refreshFinanceCloudSnapshot({assertCurrent,minimumRevision=0,minimumFinanceRevision=0}={}){
    assertCurrent?.();
    const meetsMinimum=(revision,financeRevision)=>
      (minimumRevision===0||Number.isSafeInteger(revision)&&revision>=minimumRevision)&&
      (minimumFinanceRevision===0||Number.isSafeInteger(financeRevision)&&financeRevision>=minimumFinanceRevision);
    if(session.connectionMode!=='supabase'||!session.backendReady){
      return {
        verified:true,
        state:model.state,
        revision:Number(session.dbRevision||0),
        financeRevision:Number(session.financeRevision||0),
      };
    }
    if(!isOnline())return {verified:false,state:null};
    try{
      const row=await cloudTransport.readSupabaseDocument(...(assertCurrent?[{assertCurrent}]:[]));
      assertCurrent?.();
      if(!row?.state)return {verified:false,state:null};
      // Bank receipts confirm both documents. Refuse an older/malformed read
      // before cloudPoll can publish it over the confirmed Bank candidate.
      if(!meetsMinimum(row.revision,row.financeRevision))return {verified:false,state:null};
      const kupaChanged=Number(row.revision||0)>Number(session.dbRevision||0);
      const financeChanged=Number(row.financeRevision||0)>Number(session.financeRevision||0);
      if(kupaChanged||financeChanged)await syncDocument.cloudPoll();
      assertCurrent?.();
      // A fresh GET is not evidence that the separate poll actually published
      // it (pending work, a stale second GET or ownership may block adoption).
      if(!meetsMinimum(session.dbRevision,session.financeRevision))return {verified:false,state:null};
      return {
        verified:true,
        state:row.state,
        revision:Number(row.revision||0),
        financeRevision:Number(row.financeRevision||0),
      };
    }catch(error){
      if(error.code==='FINANCE_OPERATION_SCOPE_CHANGED')throw error;
      reportError(error);
      return {verified:false,state:null};
    }
  }

  async function saveFinancePatchTracked(...args){
    const assertCurrent=args[1]?.assertCurrent||args[2]?.assertCurrent;assertCurrent?.();
    const result=await cloudTransport.saveFinancePatch(...args);
    assertCurrent?.();
    const row=result?.row;
    if(row){
      session.financeRevision=Number(row.revision||session.financeRevision||0);
      session.financeUpdatedAt=row.updated_at||session.financeUpdatedAt||null;
    }
    return result;
  }

  async function claimFinanceSyncLease(kind,token,options){
    options?.assertCurrent?.();
    if(session.connectionMode!=='supabase'||!session.backendReady)return {acquired:true,localOnly:true};
    const result=await cloudTransport.claimFinanceSyncLease(kind,token,...(options?[options]:[]));
    if(result?.acquired)remoteLeaseTokens.add(String(token));
    return result;
  }

  async function releaseFinanceSyncLease(kind,token,options){
    const key=String(token||'');
    if(!remoteLeaseTokens.has(key))return true;
    try{options?.assertCurrent?.();return await cloudTransport.releaseFinanceSyncLease(kind,key,...(options?[options]:[]))}
    finally{remoteLeaseTokens.delete(key)}
  }

  return {refreshFinanceCloudSnapshot,saveFinancePatchTracked,claimFinanceSyncLease,releaseFinanceSyncLease};
}
