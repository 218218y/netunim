import { readFileSync } from 'node:fs';
// The historical fixture remains immutable. Undo only the reviewed financial
// evidence boundary delta when comparing the surrounding provider/lease flow.
export function restoreBankMoneyBoundary(source) {
  const oldFields =
    'availableBalance:Number.isFinite(Number(business.availableBalance))?Number(business.availableBalance):null,creditLimit:Number.isFinite(Number(business.creditLimit))?Number(business.creditLimit):null,creditLimitUsed:Number.isFinite(Number(business.creditLimitUsed))?Number(business.creditLimitUsed):null,creditLimitUsedPercent:Number.isFinite(Number(business.creditLimitUsedPercent))?Number(business.creditLimitUsedPercent):null';
  return source
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
