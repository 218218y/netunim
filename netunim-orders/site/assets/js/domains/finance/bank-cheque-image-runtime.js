import {createBankChequeImageStorage} from '../../shared/bank-cheque-images.js';

export function createOrdersBankChequeImageRuntime({cloudAuth,bridge}){
  const storage=createBankChequeImageStorage({
    supaFetch:(...args)=>cloudAuth.supaFetch(...args),
    ensureSession:(...args)=>cloudAuth.ensureSession(...args),
    fetchBridgeImage:(...args)=>bridge.fetchChequeImage(...args),
  });
  return {sync:(...args)=>storage.sync(...args),download:(...args)=>storage.download(...args)};
}
