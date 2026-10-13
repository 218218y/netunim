import { clone } from '../../core/values.js';
import { createFinanceManualQueue } from '../../shared/finance-fence.js';
import {
  CLOUD_WRITE_POLICY,
  contentionDelay,
  createOperationId,
  normalizeCloudError,
  operationAuditMetadata,
  runBusyCloudWriteWithPolicy,
} from '../../shared/cloud-sync.js';
import { readFinanceWriteReceipt } from '../../shared/finance-write-receipt.js';
import { readBankSnapshotReceipt } from '../../shared/bank-snapshot-receipt.js';
import { prepareKupaWriteState } from './kupa-write-state.js';
import { createFinanceReadoutPublication } from './document-publication.js';

// Each command owns its operation ID, rebase loop and confirmation. Construction
// performs no read, write or lease acquisition. Finance has no Main-write fallback.
export function createOrdersFinanceDocumentCommands({
  operationScope,
  kupa,
  finance,
  leases,
  readout,
  delay,
}) {
  for (const [name, port, methods] of [
    ['scope', operationScope, ['capture', 'captureRead']],
    ['kupa', kupa, ['read', 'save', 'accept']],
    ['finance', finance, ['read', 'save', 'publishBankSnapshot']],
    ['leases', leases, ['claim', 'release']],
    ['readout', readout, ['refresh']],
  ])
    for (const method of methods)
      if (typeof port?.[method] !== 'function')
        throw new TypeError('orders_finance_documents_' + name + '_' + method + '_required');
  if (typeof delay !== 'function') throw new TypeError('orders_finance_documents_delay_required');
  const readKupaReadOnlyCloud = kupa.read,
    rpcSaveKupaDocument = kupa.save,
    acceptKupaCloudRow = kupa.accept;
  const readFinanceSyncDocument = finance.read,
    rpcSaveFinanceSync = finance.save;
  const contentionBackoff = (attempt) => delay(contentionDelay(attempt));
  const confirmCommittedReadout = createFinanceReadoutPublication(readout);
  const manualFinanceQueue = createFinanceManualQueue({
    claim: leases.claim,
    release: leases.release,
    createToken: () => createOperationId('finance-manual'),
    wait: delay,
  });
  async function mutateKupaCloud(mutator, { assertCurrent = operationScope.capture() } = {}) {
    assertCurrent();
    const operationId = createOperationId('kupa-finance');
    let row = await readKupaReadOnlyCloud({ assertCurrent });
    for (
      let conflictAttempt = 0;
      conflictAttempt < CLOUD_WRITE_POLICY.conflictAttempts;
      conflictAttempt++
    ) {
      assertCurrent();
      if (!row?.state) throw new Error('מסמך הקופה בענן לא נמצא');
      assertCurrent();
      const candidate = mutator(clone(row.state));
      if (!candidate) {
        acceptKupaCloudRow(row, { renderIfChanged: true, assertCurrent });
        return { saved: false, skipped: true, row };
      }
      const before = prepareKupaWriteState(row.state),
        after = prepareKupaWriteState(candidate),
        baseRevision = Number(row.revision || 0),
        audit = operationAuditMetadata({
          site: 'orders',
          mutationType: 'finance-update',
          surface: 'orders.finance.kupa-settings',
          baseRevision,
          beforeState: before,
          afterState: after,
          collections: [
            'credits',
            'cash',
            'rights',
            'notes',
            'expenses',
            'cards',
            'notesSheet.rows',
            'notesSheet.columns',
          ],
        });
      const result = await runBusyCloudWriteWithPolicy(() =>
        rpcSaveKupaDocument(after, baseRevision, operationId, audit, { assertCurrent })
      );
      assertCurrent();
      if (result.r.ok) {
        const savedRow = readFinanceWriteReceipt(
            Object.hasOwn(result, 'j') ? result.j : result.row,
            { baseRevision, sentState: after }
          ),
          publication = await confirmCommittedReadout(assertCurrent, {
            minimumRevision: savedRow.revision,
          });
        return { saved: true, skipped: false, row: savedRow, ...publication };
      }
      if (normalizeCloudError(result).kind === 'revision_conflict') {
        await contentionBackoff(conflictAttempt);
        row = await readKupaReadOnlyCloud({ assertCurrent });
        continue;
      }
      throw new Error(result.j?.message || result.txt || 'שמירת נתוני הקופה המשותפים נכשלה');
    }
    throw new Error('מסמך הקופה השתנה שוב בזמן עדכון פיננסי; לא נדרס שום נתון');
  }
  async function mutateFinanceCloud(
    mutator,
    lease = null,
    { assertCurrent = lease?.assertCurrent || operationScope.capture() } = {}
  ) {
    assertCurrent();
    if (!lease)
      return manualFinanceQueue((held) => mutateFinanceCloud(mutator, held), { assertCurrent });
    lease = { ...lease, assertCurrent };
    const operationId = createOperationId('finance');
    let row = await readFinanceSyncDocument({ assertCurrent });
    for (
      let conflictAttempt = 0;
      conflictAttempt < CLOUD_WRITE_POLICY.conflictAttempts;
      conflictAttempt++
    ) {
      assertCurrent();
      const base = row?.state && typeof row.state === 'object' ? clone(row.state) : {};
      const next = mutator(base);
      if (!next) return { saved: false, skipped: true, row };
      const candidate = JSON.parse(JSON.stringify(next));
      const baseRevision = Number(row?.revision || 0),
        audit = operationAuditMetadata({
          site: 'orders',
          mutationType: 'finance-update',
          surface: 'orders.finance.sync-document',
          baseRevision,
          beforeState: base,
          afterState: candidate,
        });
      const result = await runBusyCloudWriteWithPolicy(() =>
        rpcSaveFinanceSync(candidate, baseRevision, operationId, audit, lease)
      );
      assertCurrent();
      if (result.r.ok) {
        const savedRow = readFinanceWriteReceipt(
            Object.hasOwn(result, 'j') ? result.j : result.row,
            { baseRevision, sentState: candidate }
          ),
          publication = await confirmCommittedReadout(assertCurrent, {
            minimumFinanceRevision: savedRow.revision,
          });
        return { saved: true, skipped: false, row: savedRow, ...publication };
      }
      if (normalizeCloudError(result).kind === 'revision_conflict') {
        await contentionBackoff(conflictAttempt);
        row = await readFinanceSyncDocument({ assertCurrent });
        continue;
      }
      throw new Error(result.j?.message || result.txt || 'שמירת נתוני הסינכרון הפיננסי נכשלה');
    }
    throw new Error('נתוני הסינכרון הפיננסי השתנו שוב בזמן השמירה; לא נדרס שום נתון');
  }
  async function publishBankSnapshot(bank, snapshotToken, snapshotSeq, lease) {
    const assertCurrent = lease.assertCurrent;
    assertCurrent();
    const committed = readBankSnapshotReceipt(
      await finance.publishBankSnapshot(bank, snapshotToken, snapshotSeq, lease)
    );
    assertCurrent();
    const publication = await confirmCommittedReadout(assertCurrent, {
      minimumRevision: committed.kupa_revision,
      minimumFinanceRevision: committed.finance_revision,
    });
    return { receipt: committed, ...publication };
  }
  async function readFinance({ assertCurrent = operationScope.captureRead() } = {}) {
    assertCurrent();
    const row = await readFinanceSyncDocument({ assertCurrent });
    assertCurrent();
    return row;
  }
  return Object.freeze({
    commands: Object.freeze({
      mutateKupa: mutateKupaCloud,
      mutateFinance: mutateFinanceCloud,
      publishBankSnapshot,
    }),
    queries: Object.freeze({ readFinance }),
  });
}
