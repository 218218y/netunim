import { readFileSync } from 'node:fs';
import { declaration, tokens } from './bank_policy_ast_fixture.mjs';
const read = (site, file) =>
  readFileSync(
    new URL(
      `../netunim-${site}/site/assets/js/domains/${site === 'orders' ? 'finance' : 'credit'}/${file}.js`,
      import.meta.url,
    ),
    'utf8',
  );

// Recompose the actual workflow and actual presentation callbacks. The fixed
// historical AST is never regenerated. Only role substitutions, the new
// lifetime fence and the separately tested network envelope are reversed.
export function restoreCreditRefresh(
  controller,
  site,
  { owner = read(site, site === 'orders' ? 'credit-refresh' : 'refresh') } = {},
) {
  const name = site === 'orders' ? 'refreshCredit' : 'refreshCreditSync',
    fn = declaration(controller, name),
    step = fn.body.body.find((n) => n.type === 'TryStatement');
  const invocation = step?.block.body[0]?.argument?.argument;
  if (invocation?.callee?.object?.object?.name !== 'creditRefresh')
    return controller;
  const options = invocation.arguments[0];
  const callback = (name) => {
    const node = options.properties.find((p) => p.key.name === name)?.value;
    if (!node) throw Error('Credit presentation callback missing: ' + name);
    return node.body.type === 'BlockStatement'
      ? tokens(controller.slice(node.body.start + 1, node.body.end - 1))
      : tokens(controller.slice(node.body.start, node.body.end)) + ';';
  };
  const run = declaration(owner, 'runRefresh'),
    operation = run.body.body.find((n) => n.type === 'TryStatement');
  let prefix = tokens(owner.slice(run.body.start + 1, operation.start));
  let pipeline = tokens(owner.slice(operation.start, operation.handler.end)).replace(/\((\w+)\)=>/g,'$1=>');
  let closing = tokens(
    owner.slice(operation.finalizer.start + 1, operation.finalizer.end - 1),
  );
  prefix = prefix
    .replace(
      'let lease=null;let leaseSession=null;let assertOwner;let assertConnection;',
      'let lease=null,leaseSession=null,assertOwner,assertConnection;',
    )
    .replace(
      'let lease=null;let leaseSession=null;let autoCreditSync=cloud.readSync();let assertCurrent;let assertOwner;let assertRetained;',
      'let lease=null,leaseSession=null,autoCreditSync=cloud.readSync(),assertCurrent,assertOwner,assertRetained;',
    )
    .replaceAll('active();', '')
    .replaceAll(
      'assertOwner?.();assertConnection?.();leaseSession?.assertCurrent()',
      'assertOwner();assertConnection();leaseSession?.assertCurrent()',
    );
  pipeline = pipeline
    .replaceAll('active();', '')
    .replace(
      'const profiles=readCreditStatusProfiles(status);if(!profiles.length)',
      'if(!(status.profiles||[]).length)',
    )
    .replace(
      'profiles.map(profile=>profile.profileId)',
      '(status.profiles||[]).map(profile=>profile.profileId)',
    )
    .replace('readCreditRefreshResult(await device.sync(', 'await device.sync(')
    .replace(
      'selection:policy.selection(cloud.readSync())}));',
      'selection:policy.selection(cloud.readSync())});',
    )
    .replace(
      'selection:policy.selection(selectionSource)}));',
      'selection:policy.selection(selectionSource)});',
    )
    .replaceAll(
      'assertOwner?.();assertConnection?.()',
      'assertOwner();assertConnection()',
    )
    .replaceAll(
      'assertOwner?.();assertConnection()',
      'assertOwner();assertConnection()',
    )
    .replaceAll('assertRetained?.();', 'assertRetained();')
    .replace('onDenied();', callback('onDenied'))
    .replace('onDeferred();', callback('onDeferred'))
    .replace(
      'const deferredOnly=creditIssuesDeferred(result.errors||[]);',
      "const deferredOnly=Array.isArray(result.errors)&&result.errors.length>0&&result.errors.every(error=>error?.severity==='deferred'||error?.deferred===true);",
    );
  if (site === 'orders') {
    const failed = callback('onFailed');
    const marker = failed.indexOf('local.creditError=');
    pipeline = pipeline
      .replace(
        'onWarning(saved.publicationWarning);',
        callback('onWarning').replaceAll('warning', 'saved.publicationWarning'),
      )
      .replace(
        'onPublished(saved,result,deferredOnly);',
        callback('onPublished'),
      )
      .replace(
        'try{assertOwner();assertConnection()}catch(ownerError){error=ownerError}',
        'error=currentOperationError(error,()=>{assertOwner?.();assertConnection?.()});',
      )
      .replace(
        'try{assertOwner();assertConnection();}catch(ownerError){error=ownerError;}',
        'error=currentOperationError(error,()=>{assertOwner?.();assertConnection?.()});',
      )
      .replace(
        'const issues=readCreditFailureIssues(error),deferredOnly=creditIssuesDeferred(issues);onFailed(error,deferredOnly,schedulerEpoch);',
        failed.slice(0, marker) +
          "const deferredOnly=Array.isArray(error?.creditErrors)&&error.creditErrors.length>0&&error.creditErrors.every(item=>item?.severity==='deferred'||item?.deferred===true);" +
          failed.slice(marker),
      )
      .replace(
        'if(issues.length)',
        'if(Array.isArray(error?.creditErrors)&&error.creditErrors.length)',
      )
      .replace('errors:issues', 'errors:error.creditErrors')
      .replace(
        'if(diagnostics.publicationWarning)onDiagnosticsWarning(diagnostics.publicationWarning);',
        'if(diagnostics.publicationWarning){' +
          callback('onDiagnosticsWarning').replaceAll(
            'warning',
            'diagnostics.publicationWarning',
          ) +
          '}',
      )
      .replace(
        'onDiagnosticsFailed(persistError,schedulerEpoch);',
        callback('onDiagnosticsFailed'),
      )
      .replace(
        'onFailureFinished(deferredOnly);',
        callback('onFailureFinished'),
      );
    closing = closing.replace(
      'if(!creditRefreshScopeChanged(error))leases.reportFailure(error);',
      "if(!scopeChanged(error))console.error('orders credit sync lease release',error);",
    );
  } else {
    pipeline = pipeline
      .replace('if(!work.isActive())return false;', 'if(disposed)return false;')
      .replace('onPublished(result,deferredOnly);', callback('onPublished'))
      .replace(
        'const issues=readCreditFailureIssues(e),deferredOnly=creditIssuesDeferred(issues);onFailed(e,deferredOnly);',
        "const deferredOnly=Array.isArray(e?.creditErrors)&&e.creditErrors.length>0&&e.creditErrors.every(error=>error?.severity==='deferred'||error?.deferred===true);" +
          callback('onFailed'),
      )
      .replace(
        'if(issues.length)',
        'if(Array.isArray(e?.creditErrors)&&e.creditErrors.length)',
      )
      .replace('errors:issues', 'errors:e.creditErrors')
      .replace(
        'onDiagnosticsFailed(error)',
        callback('onDiagnosticsFailed').replace(/;$/, ''),
      )
      .replace(
        'onFailureFinished(deferredOnly)',
        callback('onFailureFinished').replace(/;$/, ''),
      );
    closing = closing.replace(
      "if(!creditRefreshRecord(error)||error.code!=='FINANCE_OPERATION_SCOPE_CHANGED')leases.reportFailure(error);",
      "if(error.code!=='FINANCE_OPERATION_SCOPE_CHANGED')console.error('credit sync lease release',error);",
    );
  }
  let combined =
    prefix +
    pipeline +
    'finally{' +
    closing +
    tokens(controller.slice(step.finalizer.start + 1, step.finalizer.end - 1)) +
    '}';
  for (const [from, to] of [
    [
      'authority.capture()',
      site === 'orders' ? 'operationScope.capture()' : 'captureOperation()',
    ],
    ['device.capture()', 'connections.queries.capture()'],
    ['device.readStatus()', 'connections.queries.readStatus()'],
    ['device.status()', 'connections.queries.snapshot().status'],
    ['device.error()', 'local.bridgeError'],
    ['device.supported(status)', 'supportedCreditBridge(status)'],
    ['device.sync(', 'bridge.syncCreditCards('],
    ['device.refreshStatus(', 'refreshCreditBridgeStatus('],
    ['device.reportFailure(', 'connections.commands.reportFailure('],
    [
      'cloud.refresh(',
      site === 'orders'
        ? 'refreshKupaReadout('
        : 'refreshFinanceCloudSnapshot(',
    ],
    [
      'cloud.readSync()',
      site === 'orders'
        ? 'checksSession.kupaCloudReadState?.creditSync'
        : 'model.state.creditSync',
    ],
    [
      'policy.lastSyncAt(checksSession.kupaCloudReadState?.creditSync)',
      'creditLastSyncAt(checksSession.kupaCloudReadState)',
    ],
    [
      'policy.lastSyncAt(finance.creditSync)',
      'creditLastSyncAt({creditSync:finance.creditSync})',
    ],
    ['policy.lastSyncAt(autoCreditSync)', 'autoCreditSync?.syncedAt'],
    ['automation.due(', site === 'orders' ? 'creditRefreshDue(' : 'due('],
    ['automation.allowed()', "financeAutomation.allowed('credit')"],
    ['automation.currentEpoch()', 'financeAutomation.currentEpoch()'],
    [
      'automation.mode()',
      site === 'orders'
        ? 'financeAutomation.preferenceState().creditAutoMode'
        : 'autoMode()',
    ],
    ['automation.markAttempt()', 'markAutoAttempt()'],
    ['leases.commands.acquire(', 'syncLeases.commands.acquire('],
    ['leases.createToken()', "uid('FINLEASE')"],
    ['publication.commit(', 'mutateFinanceCloud('],
    ['publication.publish(', 'publishCreditSync('],
    ['policy.merge(', 'mergeCreditSyncResult('],
    ['policy.selection(', 'creditSyncScrapeSelection('],
    ['policy.resolveMode(', 'resolveCreditAutoSyncMode('],
    ['policy.normalizeMode(', 'normalizeCreditFetchMode('],
  ])
    combined = combined.replaceAll(from, to);
  combined = combined.replace(/;}/g,'}')
    .replace('return false}if(auto){', 'return false}\nif(auto){')
    .replace('return false;}if(auto){', 'return false;}\nif(auto){')
    .replace(
      'try{await leaseSession?.close();',
      'try{\n        await leaseSession?.close();',
    )
    .replace(
      'try{await leaseSession?.close()}',
      'try{\n        await leaseSession?.close();}',
    );
  const reconstructed = controller.slice(fn.start, step.start) + combined + '}';
  return (
    controller.slice(0, fn.start) + reconstructed + controller.slice(fn.end)
  );
}
