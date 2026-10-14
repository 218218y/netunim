import { readFileSync } from 'node:fs';
import {restoreOrdersBankPublication} from './orders_bank_publication_policy_fixture.mjs';
import {restoreFinanceLeaseOwnership} from './finance_lease_policy_fixture.mjs';
// The historical fixture remains immutable. Undo only the reviewed financial
// evidence boundary delta when comparing the surrounding provider/lease flow.
export function restoreBankMoneyBoundary(source) {
  source=restoreFinanceLeaseOwnership(source);
  if(source.includes('bankSnapshots.commands.publish('))source=restoreOrdersBankPublication(source);
  const oldFields =
    'availableBalance:Number.isFinite(Number(business.availableBalance))?Number(business.availableBalance):null,creditLimit:Number.isFinite(Number(business.creditLimit))?Number(business.creditLimit):null,creditLimitUsed:Number.isFinite(Number(business.creditLimitUsed))?Number(business.creditLimitUsed):null,creditLimitUsedPercent:Number.isFinite(Number(business.creditLimitUsedPercent))?Number(business.creditLimitUsedPercent):null';
  return source
    .replaceAll('assertConnection=bankConnections.queries.capture();','assertConnection=bankPairingScope.capture();')
    .replace('const status=await bankConnections.queries.readStatus();assertCurrent();',"const status=await bridge.status();assertCurrent();local.bankStatus=status;local.bankStatusChecked=true;local.bankBridgeError='';")
    .replace('if(!bankConnections.queries.supported(status))','if(Number(status.bridgeVersion||0)<BANK_BRIDGE_VERSION)')
    .replace('bankConnections.commands.recordScan({lastScrapeAt:','local.bankStatus={...status,lastScrapeAt:')
    .replace("accountRole:homeFailure?'home':''},assertConnection);","accountRole:homeFailure?'home':''};")
    .replace('if(assertConnection)bankConnections.commands.reportFailure(error,assertConnection);',"if(error?.code==='BRIDGE_UNAVAILABLE'||error?.code==='BRIDGE_TIMEOUT')local.bankBridgeError=local.bankError;\n      if(error?.availableAccounts?.length)local.bankStatus={...(local.bankStatus||{}),availableAccounts:error.availableAccounts,accountRole:error.accountRole||''};")
    .replace(
      'const {business,home,homeFailure}=readBankBalanceResult(result);',
      `const business=result.accounts?.business||result,home=result.accounts?.home??null,homeFailure=result.accountFailures?.home||null;
 if(!Number.isFinite(Number(business?.balance)))throw new Error('Bank Bridge לא החזיר יתרה עסקית תקינה');
 if(home&&!Number.isFinite(Number(home.balance)))throw new Error('Bank Bridge לא החזיר יתרה ביתית תקינה');`
    )
    .replace('...bankSnapshotFinancials(business)', oldFields)
    .replace('heartbeat=null,assertOwner,assertConnection;', 'heartbeat=null,assertOwner;')
    .replace(
      'assertOwner();assertConnection();heartbeat?.assertCurrent()',
      'assertOwner();heartbeat?.assertCurrent()'
    )
    .replace("assertConnection=bankPairingScope.capture();notifyFinanceStatus('bank');", '')
    .replace("local.bankBusy=true;local.bankResultReady=false;local.bankError='';local.bankErrorAt=null;","local.bankBusy=true;local.bankResultReady=false;local.bankError='';local.bankErrorAt=null;notifyFinanceStatus('bank');")
    .replace(
      'error=currentOperationError(error,()=>{assertOwner?.();assertConnection?.()});',
      'error=currentOperationError(error,assertOwner);'
    );
}

export function restoreBankProviderMoneyBoundary(source) {
  const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/bank-money-before-provider.json', import.meta.url), 'utf8')
  );
  const start = source.indexOf('    const balance = readBankMoney('),
    end = source.indexOf('      throw stageError(', start);
  if (start < 0 || end < 0) return source;
  return source.slice(0, start) + fixture.moneyPrefix + source.slice(end);
}
