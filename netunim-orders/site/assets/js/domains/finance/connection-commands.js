// Device connection commands expose presentation state through the existing
// local model. Accepted-work lifetime remains with the Finance controller.
export function createFinanceConnectionCommands({local,bridge,bankConnections,connections,policy,toast}){
const {scopeChanged,startAutoSync}=policy;
const refreshBankBridgeStatus=bankConnections.queries.refreshStatus,refreshCreditBridgeStatus=connections.queries.refreshStatus;
const captureBankConnection=bankConnections.queries.capture;
  async function saveBridgeToken(value){
    const token=bridge.setBridgeToken(value);
    local.bankError='';local.creditError='';local.bankErrorAt=null;local.creditErrorAt=null;
    bankConnections.queries.snapshot();connections.queries.snapshot();
    if(token){
      const assertConnection=bankConnections.queries.capture();
      await Promise.all([refreshBankBridgeStatus({quiet:true}),refreshCreditBridgeStatus({quiet:true})]);
      try{assertConnection()}catch{return token}
      toast('מפתח Bank Bridge נשמר במחשב זה');
    }else{toast('מפתח Bank Bridge הוסר מהמחשב הזה')}
    startAutoSync();return token;
  }

  async function bankConnectionWrite(command,{clearBefore=false}={}){
    if(local.bankBusy)return false;
    local.bankBusy=true;
    if(clearBefore){local.bankError='';local.bankErrorAt=null}
    let assertConnection;
    try{
      assertConnection=captureBankConnection();
      const result=await command();
      assertConnection();
      if(result.ok){local.bankError='';local.bankErrorAt=null}
      else if(result.failure){local.bankError=result.failure;local.bankErrorAt=new Date().toISOString();toast(result.failure)}
      return result.ok;
    }catch(error){
      try{assertConnection?.()}catch{return false}
      if(scopeChanged(error))return false;
      local.bankError=error?.message||String(error);local.bankErrorAt=new Date().toISOString();toast(local.bankError);
      return false;
    }finally{local.bankBusy=false}
  }
  function configureBankBridge(input){return bankConnectionWrite(()=>bankConnections.commands.configure(input),{clearBefore:true})}
  function selectBankBridgeAccount(role,branchNumber,accountNumber){return bankConnectionWrite(()=>bankConnections.commands.selectAccount(role,branchNumber,accountNumber))}
  function deleteBankBridgeCredentials(){return bankConnectionWrite(bankConnections.commands.deleteCredentials)}
  function exportBankChequeDiagnostics(){return local.bankBusy||local.creditBusy?Promise.resolve(false):bankConnections.commands.exportDiagnostics()}

return {saveBridgeToken,configureBankBridge,selectBankBridgeAccount,deleteBankBridgeCredentials,exportBankChequeDiagnostics};
}
