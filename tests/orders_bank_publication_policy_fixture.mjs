import { readFileSync } from 'node:fs';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';
import {expandOrdersReconciliation} from './bank_archive_reconciliation_policy_fixture.mjs';
import {restoreFinanceLeaseOwnership} from './finance_lease_policy_fixture.mjs';
const folder = '../netunim-orders/site/assets/js/domains/finance/';
const read = (name) => readFileSync(new URL(folder + name + '.js', import.meta.url), 'utf8');


export function restoreOrdersBankPublication(
  controller,
  { owner = read('bank-snapshot-publication'), model = read('bank-snapshot-policy') } = {}
) {
  controller=restoreFinanceLeaseOwnership(controller);
  owner=expandOrdersReconciliation(owner);
  const publish = declaration(owner, 'publish');
  // The owner is formatted, so locate declarations by their actual AST spans.
  const statements = publish.body.body,
    decode = statements.find(
      (n) =>
        n.type === 'VariableDeclaration' &&
        n.declarations.some(
          (d) =>
            d.id.type === 'ObjectPattern' && d.id.properties.some((p) => p.key.name === 'source')
        )
    );
  const failure = statements.find(
    (n) => n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id.name === 'failure')
  );
  if (!decode || !failure) throw Error('production publication sequence missing');
  let pipeline = owner.slice(decode.start, failure.start);
  const build = declaration(model, 'buildSnapshot'),
    planStatements = build.body.body.filter((n) => n.type !== 'ReturnStatement');
  const plan = model
    .slice(planStatements[0].start, planStatements.at(-1).end)
    .replaceAll('checksState.kupa', 'checksSession.kupaCloudReadState')
    .replace(
      /observedChecksSequence\(kupa,\s*checksState\.bankEvents\)/g,
      'observedChecksSequence(kupa)'
    );
  const buildNode = statements.find(
    (n) =>
      n.type === 'VariableDeclaration' &&
      n.declarations.some(
        (d) => d.init?.callee?.object?.name === 'policy' && d.init.callee.property.name === 'build'
      )
  );
  pipeline = pipeline.replace(owner.slice(buildNode.start, buildNode.end), plan);
  const first = statements.find(
    (n) => n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id.name === 'first')
  );
  const archive = statements.find(
    (n) =>
      n.type === 'VariableDeclaration' &&
      n.declarations.some((d) => d.id.name === 'businessArchive')
  );
  pipeline = pipeline.replace(
    owner.slice(first.start, archive.end),
    'const businessArchive=verified[0].rows,businessDirect=verified[0].directSnapshot;'
  );
  pipeline = tokens(pipeline)
    .replace('const {business,home,homeFailure,source}=', 'const {business,home,homeFailure}=')
    .replace('source.fetchedAt', 'result.fetchedAt')
    .replaceAll('policy.accountId(', 'accountIdOf(')
    .replaceAll('policy.coverage(', 'completeTransactionCoverage(')
    .replaceAll('policy.audit(', 'assertBankArchiveCoverage(')
    .replaceAll('transactions.reconcile(', 'syncBankTransactionsSnapshot(')
    .replaceAll('images.sync(', 'syncBankChequeImages(')
    .replaceAll('archive.read(', 'archive.queries.readSnapshot(')
    .replaceAll('authority.captureRead()', 'operationScope.captureRead()')
    .replaceAll('checks.hasLocalWork()', 'checksHaveLocalWork()')
    .replaceAll(
      '(record(businessMerge)?businessMerge.result:null)||null',
      'businessMerge?.result||null'
    )
    .replaceAll('(record(homeMerge)?homeMerge.result:null)||null', 'homeMerge?.result||null')
    .replaceAll('(record(error)?error.message:null)||error', 'error?.message||error')
    .replaceAll("role:('home')", "role:'home'")
    .replaceAll('home?policy.transactions(home):[]', 'home?.transactions||[]')
    .replaceAll('policy.transactions(business)', '(business.transactions||[])')
    .replaceAll('policy.transactions(home)', '(home.transactions||[])')
    .replaceAll(
      'publication.save(bank,snapshotToken,snapshotSeq,lease)',
      'documents.commands.publishBankSnapshot(financeBankPayload(nextBank),snapshotToken,snapshotSeq,lease)'
    )
    .replaceAll('archive.publish(', 'publishDisplayArchive(');
  const scan = statements.find(
    (n) => n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id.name === 'scan')
  ).declarations[0].init;
  pipeline +=
    'bankConnections.commands.recordScan(' +
    tokens(owner.slice(scan.start, scan.end)).replaceAll('failure', 'homeFailure') +
    ',assertConnection);';
  const refresh = declaration(controller, 'refreshBank');
  const delegated = refresh.body.body.find((n) => n.type === 'TryStatement').block.body;
  const call = delegated.find(
    (n) =>
      n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id.name === 'publication')
  );
  const scanCall = delegated.find(
    (n) =>
      n.type === 'ExpressionStatement' &&
      n.expression.callee?.object?.object?.name === 'bankConnections' &&
      n.expression.callee.property.name === 'recordScan'
  );
  if (!call || !scanCall) throw Error('controller publication delegation missing');
  return (controller.slice(0, call.start) + pipeline + controller.slice(scanCall.end)).replaceAll(
    'bankSnapshots.commands.prepare(',
    'prepareBankSnapshot('
  );
}
