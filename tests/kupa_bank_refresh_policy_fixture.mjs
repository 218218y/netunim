import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { declaration, tokens } from './bank_policy_ast_fixture.mjs';
const read = name =>
  readFileSync(
    new URL(
      '../netunim-kupa/site/assets/js/domains/bank/' + name + '.js',
      import.meta.url
    ),
    'utf8'
  );
const composition = () =>
  readFileSync(
    new URL(
      '../netunim-kupa/site/assets/js/composition/bank.js',
      import.meta.url
    ),
    'utf8'
  );
const compact = source =>
  tokens(source)
    .replace(/\((\w+)\)=>/g, '$1=>')
    .replace(/;}/g, '}');
function find(root, predicate) {
  if (!root || typeof root !== 'object') return;
  if (predicate(root)) return root;
  for (const value of Object.values(root)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = find(child, predicate);
        if (found) return found;
      }
    } else {
      const found = find(value, predicate);
      if (found) return found;
    }
  }
}
function bankReader(source) {
  const call = find(
    parse(source, { ecmaVersion: 'latest', sourceType: 'module' }),
    node =>
      node.type === 'CallExpression' &&
      node.callee?.name === 'createKupaBankSnapshotPolicy'
  );
  const reader = call?.arguments[0].properties
    .find(p => p.key.name === 'source')
    ?.value.properties.find(p => p.key.name === 'readBank')?.value;
  if (!reader || reader.body.type === 'BlockStatement')
    throw Error('actual Bank source reader required');
  return compact(source.slice(reader.body.start, reader.body.end));
}
export function restoreKupaBankFeedPolicy(model = read('snapshot-policy')) {
  const fn = declaration(model, 'feedFromSnapshot');
  return compact(model.slice(fn.start, fn.end))
    .replaceAll('feeds.normalize(', 'normalizeBankFeed(')
    .replaceAll('feeds.recurringHistory(', 'bankRecurringDebitHistoryData(')
    .replaceAll('source.readBank().homeFeed', 'model.state.bank?.homeFeed')
    .replaceAll('source.readBank().feed', 'model.state.bank?.feed');
}
// Recompose actual candidate, operation and presentation code. Fixed baseline
// functions are never copied back or regenerated. Only reviewed role changes,
// explicit lifetime/evidence guards and payload projection are reversed.
export function restoreKupaBankRefresh(
  controller,
  {
    owner = read('refresh'),
    model = read('snapshot-policy'),
    wiring = composition()
  } = {}
) {
  const fn = declaration(controller, 'refreshBankBalance'),
    step = fn.body.body.find(n => n.type === 'TryStatement');
  const invocation = step?.block.body[0]?.argument?.argument;
  if (invocation?.callee?.object?.object?.name !== 'bankRefresh')
    return controller;
  const callbacks = invocation.arguments[0];
  const callback = name => {
    const node = callbacks.properties.find(p => p.key.name === name)?.value;
    if (!node) throw Error('missing Bank callback ' + name);
    return node.body.type === 'BlockStatement'
      ? compact(controller.slice(node.body.start + 1, node.body.end - 1))
      : compact(controller.slice(node.body.start, node.body.end)) + ';';
  };
  const run = declaration(owner, 'runRefresh'),
    operation = run.body.body.find(n => n.type === 'TryStatement');
  let prefix = compact(owner.slice(run.body.start + 1, operation.start))
    .replace(
      'let lease=null;let leaseSession=null;let assertOwner;let assertConnection;',
      'let lease=null,leaseSession=null,assertOwner,assertConnection;'
    )
    .replaceAll('active();', '')
    .replace(
      'assertOwner?.();assertConnection?.();leaseSession?.assertCurrent()',
      'assertOwner();assertConnection();leaseSession?.assertCurrent()'
    );
  const prepare = declaration(model, 'prepare'),
    statements = prepare.body.body;
  const prepared = compact(
    model.slice(statements[1].start, statements.at(-1).start)
  ).replace('source.readBank()', bankReader(wiring));
  const build = declaration(model, 'build'),
    returned = build.body.body.find(n => n.type === 'ReturnStatement');
  const candidate =
    'const nextBank=' +
    compact(model.slice(returned.argument.start, returned.argument.end)) +
    ';';
  let pipeline = compact(owner.slice(operation.start, operation.handler.end));
  const prep = declaration(owner, 'runRefresh')
    .body.body.find(n => n.type === 'TryStatement')
    .block.body.find(
      n =>
        n.type === 'VariableDeclaration' &&
        n.declarations.some(d => d.id.name === 'prepared')
    );
  pipeline = pipeline
    .replace(compact(owner.slice(prep.start, prep.end)), prepared)
    .replace('const nextBank=policy.build(prepared);', candidate)
    .replaceAll('prepared.warnings', 'warnings')
    .replace('const cloudLease=cloudArchive?requireCloudLease(lease):null;', '')
    .replace('if(cloudLease){', 'if(cloudArchive){')
    .replace('historyDays,lease:cloudLease}', 'historyDays,lease}')
    .replaceAll('requireCloudLease(lease)', 'lease')
    .replace(
      'const evidence=await device.fetchBalance',
      'const result=await device.fetchBalance'
    )
    .replace(
      'const {source:result,business,home,homeFailure:failure}=readBankBalanceResult(evidence);const homeFailure=readHomeFailure(failure);',
      'const {business,home,homeFailure}=readBankBalanceResult(result);'
    )
    .replace(
      "let businessArchive=Array.isArray(business.transactions)?business.transactions:[];let homeArchive=home&&Array.isArray(home.transactions)?home.transactions:[];let archiveAudit=null;let imageSyncWarning='';let archiveCandidate=null;",
      "let businessArchive=Array.isArray(business.transactions)?business.transactions:[],homeArchive=home&&Array.isArray(home.transactions)?home.transactions:[],archiveAudit=null,imageSyncWarning='',archiveCandidate=null;"
    )
    .replace('onStarted();', callback('onStarted'))
    .replace('onDenied();', callback('onDenied'))
    .replace(/onCloudSaved\(historyDays\);?/, callback('onCloudSaved'))
    .replace(
      'onPublished({business,home,homeFailure,fetchedAt,warnings:warnings,bridgeStatus,assertConnection});',
      callback('onPublished')
    );
  const failure = callback('onFailed'),
    first = failure.indexOf(';') + 1;
  pipeline = pipeline.replace(
    'try{active();assertOwner?.();assertConnection?.()}catch(scopeError){e=scopeError}onFailed(e,assertConnection);',
    failure.slice(0, first) +
      'try{assertOwner?.();assertConnection?.()}catch(scopeError){e=scopeError}' +
      failure.slice(first)
  );
  const closing = compact(
    owner.slice(operation.finalizer.start + 1, operation.finalizer.end - 1)
  ).replace(
    'leases.reportFailure(error)',
    "console.error('bank sync lease release',error)"
  );
  let combined =
    prefix +
    pipeline +
    'finally{' +
    closing +
    compact(
      controller.slice(step.finalizer.start + 1, step.finalizer.end - 1)
    ) +
    '}';
  for (const [from, to] of [
    ['authority.capture()', 'operationScope.capture()'],
    ['device.capture()', 'connections.queries.capture()'],
    ['device.readStatus()', 'connections.queries.readStatus()'],
    ['device.supported(', 'connections.queries.supported('],
    ['device.fetchBalance(', 'bridge.fetchBalance('],
    ['cloud.refresh(', 'refreshFinanceCloudSnapshot('],
    ['cloud.lastSyncAt(', 'sharedBankLastSyncAt('],
    ['cloud.currentState()', 'model.state'],
    ['cloud.mode()', 'session.connectionMode'],
    ['cloud.checksHaveLocalWork()', 'sharedChecksHaveLocalWork()'],
    ['automation.due(', 'bankAutoRefreshDue('],
    ['automation.markAttempt()', 'bridge.markAutoAttempt()'],
    ['leases.commands.acquire(', 'syncLeases.commands.acquire('],
    ['leases.createToken()', "uid('FINLEASE')"],
    ['publication.prepare(', 'prepareBankSnapshot('],
    ['publication.reconcile(', 'archiveReconciliation.commands.sync('],
    ['publication.publishCloud(', 'snapshots.commands.publishCloud('],
    ['publication.publishLocal(', 'snapshots.commands.publishLocal('],
    ['publication.readoutWarning', 'BANK_READOUT_WARNING'],
    [
      'financeBank(finance)?.archiveInitialized',
      'finance?.state?.bank?.archiveInitialized'
    ],
    [
      'financeBank(finance)?.archiveVersion',
      'finance?.state?.bank?.archiveVersion'
    ],
    ['feeds.roundMoney(', 'wholeMoney('],
    ['identity.now()', 'new Date().toISOString()'],
    ['identity.today()', 'todayISO()'],
    ['identity.createToken()', "uid('BANK')"],
    ['source.observedSequence()', 'sharedChecksObservedSequence()']
  ])
    combined = combined.replaceAll(from, to);
  combined = combined
    .replaceAll('active();', '')
    .replaceAll(
      'assertOwner?.();assertConnection?.()',
      'assertOwner();assertConnection()'
    )
    .replace(
      'try{assertOwner();assertConnection()}catch(scopeError)',
      'try{assertOwner?.();assertConnection?.()}catch(scopeError)'
    )
    .replace('return false}const finance=', 'return false}\nconst finance=')
    .replace(
      'try{await leaseSession?.close()}',
      'try{\n      await leaseSession?.close();}'
    );
  const reconstructed = controller.slice(fn.start, step.start) + combined + '}';
  return (
    controller.slice(0, fn.start) +
    reconstructed +
    controller.slice(fn.end) +
    '\n' +
    restoreKupaBankFeedPolicy(model)
  );
}
