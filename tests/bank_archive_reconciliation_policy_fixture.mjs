import { readFileSync } from 'node:fs';
import { declaration, tokens } from './bank_policy_ast_fixture.mjs';
const read = (name) => readFileSync(new URL('../shared/' + name + '.js', import.meta.url), 'utf8');
export const archivePolicySource = () => read('bank-archive-policy');
export const archiveCoreSource = () => read('bank-archive-reconciliation');
const variable = (fn, name) =>
  [
    ...fn.body.body,
    ...fn.body.body.filter((n) => n.type === 'TryStatement').flatMap((n) => n.block.body),
  ].find((n) => n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id.name === name));

export function coreSequence(shared = archiveCoreSource()) {
  const fn = declaration(shared, 'sync'),
    first = variable(fn, 'businessCoverage'),
    last = variable(fn, 'requireExactArchive');
  return tokens(shared.slice(first.start, last.end));
}
export function expandOrdersReconciliation(owner, shared = archiveCoreSource()) {
  if (!owner.includes('reconciliation.commands.sync(')) return owner;
  const fn = declaration(owner, 'publish'),
    fetched = variable(fn, 'fetchedAt');
  const call = fn.body.body.find(
    (n) =>
      n.type === 'VariableDeclaration' &&
      n.declarations.some(
        (d) =>
          d.init?.type === 'AwaitExpression' &&
          d.init.argument.callee?.object?.object?.name === 'reconciliation'
      )
  );
  const index = fn.body.body.indexOf(call),
    guard = fn.body.body[index + 1];
  if (!call || guard.expression?.callee?.name !== 'assertCurrent')
    throw Error('Orders reconciliation delegation missing');
  const core = declaration(shared, 'sync'),
    ids = variable(core, 'businessAccount');
  const header =
    tokens(owner.slice(fetched.start, fetched.end)).slice(0, -1) +
    ',' +
    tokens(shared.slice(ids.start, ids.end))
      .replace(/^const /, '')
      .replaceAll('bankArchiveAccountId(', 'policy.accountId(');
  const sequence = coreSequence(shared)
    .replaceAll('bankTransactionCoverage(', 'policy.coverage(')
    .replaceAll('verifyBankArchiveCoverage(', 'policy.audit(')
    .replace("'bank_archive_read_required'", "'orders_bank_snapshot_archive_read_required'")
    .replaceAll('business.transactions||[]', 'policy.transactions(business)')
    .replaceAll('home.transactions||[]', 'policy.transactions(home)')
    .replaceAll('(policy.transactions(business))','policy.transactions(business)')
    .replaceAll('(policy.transactions(home))','policy.transactions(home)');
  return owner.slice(0, fetched.start) + header + sequence + owner.slice(guard.end);
}
export function restoreKupaReconciliation(controller, shared = archiveCoreSource()) {
  const original=declaration(controller,'refreshBankBalance'),fetched=variable(original,'fetchedAt');
  if(!fetched.declarations.some(d=>d.id.name==='homeAccount')){
    const restored=tokens(controller.slice(fetched.start,fetched.end)).replace('businessAccount=accountIdOf(business);',"businessAccount=accountIdOf(business),homeAccount=home?accountIdOf(home):'';");
    controller=controller.slice(0,fetched.start)+restored+controller.slice(fetched.end);
  }
  const fn = declaration(controller, 'refreshBankBalance');
  const block = fn.body.body
    .find((n) => n.type === 'TryStatement')
    .block.body.find((n) => n.type === 'IfStatement' && n.test.name === 'cloudArchive');
  let sequence = coreSequence(shared)
    .replaceAll('bankTransactionCoverage(', 'completeTransactionCoverage(')
    .replaceAll('verifyBankArchiveCoverage(', 'assertBankArchiveCoverage(')
    .replaceAll('transactions.reconcile(', 'syncBankTransactionsSnapshot(')
    .replaceAll('images.sync(', 'syncBankChequeImages(')
    .replaceAll('archive.read(', 'archive.queries.readSnapshot(')
    .replaceAll('authority.captureRead()', 'operationScope.captureRead()')
    .replaceAll('(record(error)?error.message:null)||error', 'error?.message||error')
    .replaceAll(
      '(record(businessMerge)?businessMerge.result:null)||null',
      'businessMerge?.result||null'
    )
    .replaceAll('(record(homeMerge)?homeMerge.result:null)||null', 'homeMerge?.result||null')
    .replace('...(home?(home.transactions||[]):[])', '...(home?.transactions||[])')
    .replace('...(home?home.transactions||[]:[])', '...(home?.transactions||[])')
    .replace("role:('home')", "role:'home'")
    .replace("...(home&&homeAccount?[{role:'home'", "...(homeAccount?[{role:'home'")
    .replace("let imageSyncWarning='';", '')
    .replace(
      /const first=verified\[0\];if\(!first\)throw new Error\('bank_archive_read_required'\);const businessArchive=first.rows,businessDirect=first.directSnapshot;/,
      'const nextBusinessArchive=verified[0].rows,nextBusinessDirect=verified[0].directSnapshot;'
    )
    .replace(
      'const homeArchive=verified[1]?.rows||[],homeDirect=verified[1]?.directSnapshot??null;',
      'const nextHomeArchive=verified[1]?.rows||[],nextHomeDirect=verified[1]?.directSnapshot??null;'
    )
    .replace(
      'assertCurrent();const assertReadable=',
      'assertCurrent();businessArchive=nextBusinessArchive;homeArchive=nextHomeArchive;const assertReadable='
    )
    .replace('const archiveCandidate=', 'archiveCandidate=')
    .replaceAll('directSnapshot:businessDirect', 'directSnapshot:nextBusinessDirect')
    .replaceAll('directSnapshot:homeDirect', 'directSnapshot:nextHomeDirect')
    .replace(',archiveAudit={', ';archiveAudit={');
  return (
    controller.slice(0, block.start) +
    'if(cloudArchive){' +
    sequence +
    '}' +
    controller.slice(block.end)
  );
}
