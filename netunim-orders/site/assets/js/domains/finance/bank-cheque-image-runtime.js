import {createBankChequeImageStorage} from '../../shared/bank-cheque-images.js';

export function createOrdersBankChequeImageRuntime({cloudAuth,bridge,operationScope}){
  const storage=createBankChequeImageStorage({
    supaFetch:(...args)=>cloudAuth.supaFetch(...args),
    ensureSession:(...args)=>cloudAuth.ensureSession(...args),
    fetchBridgeImage:(...args)=>bridge.fetchChequeImage(...args),
  });
  return {sync:(...args)=>storage.sync(...args),download:(date,key)=>storage.download(date,key,{assertCurrent:operationScope.captureRead()})};
}
