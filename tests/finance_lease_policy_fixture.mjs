// Reconstruct only the reviewed lease ownership delta. Provider, merge,
// publication, freshness and scheduler policies stay in their actual callers.
export function restoreFinanceLeaseOwnership(source) {
  source=source.replace(/(snapshots\.commands\.publishLocal\([^\n]*),\(\)=>\{assertOwner\(\);assertConnection\(\)\}\)/,'$1,assertCurrent)');
  source = source
    .replace(/\r\n/g, '\n')
    .replaceAll(
      'let lease=null,leaseSession=null,assertOwner,assertConnection;',
      "let leaseToken='',leaseHeld=false,lease=null,heartbeat=null,assertOwner,assertConnection;"
    )
    .replace(
      'let lease=null,leaseSession=null,autoCreditSync=model.state.creditSync,assertCurrent,assertOwner;',
      "let leaseToken='',leaseHeld=false,lease=null,heartbeat=null,autoCreditSync=model.state.creditSync,assertCurrent,assertOwner;"
    )
    .replaceAll('leaseSession?.assertCurrent()', 'heartbeat?.assertCurrent()');
  for (const kind of ['bank', 'credit']) {
    const acquire = `leaseSession=syncLeases.commands.acquire('${kind}',uid('FINLEASE'),{assertCurrent:()=>{assertOwner();assertConnection()}});`;
    if (!source.includes(acquire)) continue;
    const localCredit = kind === 'credit' && source.includes('async function refreshCreditSync(');
    const claim = localCredit ? 'claimLease' : 'claimFinanceSyncLease';
    const authority = localCredit ? 'assertCurrent' : 'assertCurrent:assertOwner';
    const claimed = `lease=await ${claim}('${kind}',leaseToken,{${authority}});leaseHeld=lease?.acquired===true;`;
    const replacement =
      source.includes('async function refreshBankBalance(') || localCredit
        ? `leaseToken=uid('FINLEASE');\n    ${claimed}`
        : `leaseToken=uid('FINLEASE');${claimed}`;
    source = source.replace(acquire, replacement).replace('lease=await leaseSession.ready;', '');
    const denied = new RegExp('(if\\(!lease\\.acquired\\)\\{[^\\n]*\\})');
    const timers =
      source.includes('async function refreshBankBalance(') || localCredit
        ? ',{setTimer:timers.setTimeout.bind(timers),clearTimer:timers.clearTimeout.bind(timers)}'
        : '';
    source = source.replace(
      denied,
      (match) =>
        match.replace('!lease.acquired', '!leaseHeld') +
        `\n      heartbeat=startFinanceLeaseHeartbeat({...lease,assertCurrent:assertOwner},${claim}${timers});` +
        (localCredit ? '\n      heartbeats.add(heartbeat);' : '')
    );
    source = source.replace(
      'try{\n      await leaseSession?.close();',
      `await heartbeat?.stop();\n    if(leaseHeld)try{\n      await releaseFinanceSyncLease('${kind}',leaseToken,{assertCurrent:assertOwner});`
    );
    source = source.replace(
      'try{\n        await leaseSession?.close();',
      `await heartbeat?.stop();\n      ${localCredit ? 'heartbeats.delete(heartbeat);\n      ' : ''}if(leaseHeld)try{\n        await releaseFinanceSyncLease('${kind}',leaseToken,{assertCurrent:assertOwner});`
    );
  }
  return source;
}
