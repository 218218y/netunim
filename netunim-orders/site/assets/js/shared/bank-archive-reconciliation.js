// @ts-check
import { createRuntimeTaskOwner } from './runtime-task-owner.js';
import {
  bankArchiveAccountId,
  bankTransactionCoverage,
  verifyBankArchiveCoverage,
} from './bank-archive-policy.js';

/** @typedef {() => undefined} ArchiveGuard */
/** @typedef {import('./bank-balance-result.js').BankAccountSnapshot} BankAccount */
/** @typedef {import('./bank-archive-policy.js').TransactionCoverage} TransactionCoverage */
/** @typedef {{leaseName:'bank',leaseToken:string,fenceEpoch:number,assertCurrent:ArchiveGuard}&Record<string,unknown>} BankLease */
/** @typedef {{business:BankAccount,home:BankAccount|null,fetchedAt:unknown,historyDays:number,lease:BankLease}} ReconciliationRequest */
/** @typedef {{accountKey:string,syncKey:string,rows:readonly unknown[],directSnapshot:unknown,assertCurrent:ArchiveGuard}} ArchivePublication */
/** @typedef {{business:ArchivePublication,home?:ArchivePublication}} ArchiveCandidate */
/** @typedef {{role:'business'|'home',accountKey:string,rows:readonly unknown[],directSnapshot:unknown}} ArchiveRead */
/** @typedef {{version:number,verifiedAt:unknown,historyDays:number,business:Record<string,unknown>,home:Record<string,unknown>|null}} ArchiveAudit */
/** @typedef {{businessAccount:unknown,homeAccount:unknown,businessCoverage:TransactionCoverage,homeCoverage:TransactionCoverage|null,businessArchive:readonly unknown[],homeArchive:readonly unknown[],archiveCandidate:ArchiveCandidate,archiveAudit:ArchiveAudit,imageSyncWarning:string}} ArchiveReconciliation */
/** @typedef {{commands:{sync:(request:ReconciliationRequest)=>Promise<ArchiveReconciliation>},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} ReconciliationCapability */
/** @typedef {{
 * transactions:{reconcile:(account:unknown,role:'business'|'home',rows:unknown,options:{lease:BankLease,snapshotAt:unknown,coverage:TransactionCoverage|null,complete:boolean})=>Promise<unknown>},
 * images:{sync:(rows:readonly unknown[],options:{assertCurrent:ArchiveGuard})=>Promise<{warnings?:readonly unknown[]}|null>},
 * archive:{read:(targets:readonly {role:'business'|'home',accountKey:string}[],options:{days:number,assertCurrent:ArchiveGuard})=>Promise<ArchiveRead[]>},
 * authority:{captureRead:()=>ArchiveGuard}
 * }} ReconciliationPorts */

/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** @param {unknown} error */
function scopeChanged(error) {
  return (
    record(error) &&
    [
      'FINANCE_OPERATION_SCOPE_CHANGED',
      'CREDIT_CONNECTION_SCOPE_CHANGED',
      'BRIDGE_PAIRING_SCOPE_CHANGED',
    ].includes(String(error.code))
  );
}

/**
 * One cloud archive sequence for both apps. Morning decoration is supplied by
 * the Orders read adapter; document/local persistence belongs to the consumers.
 * Each composition owns its own accepted-work lifetime and resource instances.
 * @param {ReconciliationPorts} ports @returns {ReconciliationCapability}
 */
export function createBankArchiveReconciliation({ transactions, images, archive, authority }) {
  /** @type {[string,unknown,string[]][]} */ const required = [
    ['transactions', transactions, ['reconcile']],
    ['images', images, ['sync']],
    ['archive', archive, ['read']],
    ['authority', authority, ['captureRead']],
  ];
  for (const [name, port, methods] of required)
    for (const method of methods)
      if (typeof (/** @type {Record<string,unknown>} */ (port)?.[method]) !== 'function')
        throw new TypeError('bank_archive_reconciliation_' + name + '_' + method + '_required');
  const work = createRuntimeTaskOwner();
  /** @returns {undefined} */
  function active() {
    if (!work.isActive())
      throw Object.assign(new Error('bank_archive_reconciliation_disposed'), {
        code: 'FINANCE_OPERATION_SCOPE_CHANGED',
      });
  }

  /** @param {ReconciliationRequest} options @returns {Promise<ArchiveReconciliation>} */
  async function sync({ business, home, fetchedAt, historyDays, lease }) {
    const ownerGuard = lease.assertCurrent;
    /** @type {ArchiveGuard} */ const assertCurrent = () => {
      active();
      ownerGuard();
    };
    assertCurrent();
    lease = { ...lease, assertCurrent };
    const businessAccount = bankArchiveAccountId(business),
      homeAccount = home ? bankArchiveAccountId(home) : '';
    try {
      const businessCoverage = bankTransactionCoverage(business),
        homeCoverage = home ? bankTransactionCoverage(home) : null;
      const businessMerge = await transactions.reconcile(
        businessAccount,
        'business',
        business.transactions || [],
        {
          lease,
          snapshotAt: fetchedAt,
          coverage: businessCoverage,
          complete: businessCoverage.complete,
        }
      );
      assertCurrent();
      const homeMerge =
        home && homeAccount
          ? await transactions.reconcile(homeAccount, 'home', home.transactions || [], {
              lease,
              snapshotAt: fetchedAt,
              coverage: homeCoverage,
              complete: homeCoverage?.complete === true,
            })
          : null;
      assertCurrent();
      let imageSyncWarning = '';
      try {
        const imageSync = await images.sync(
          [
            .../** @type {unknown[]} */ (business.transactions || []),
            .../** @type {unknown[]} */ (home ? home.transactions || [] : []),
          ],
          { assertCurrent }
        );
        assertCurrent();
        if (imageSync?.warnings?.length)
          imageSyncWarning = `תמונות שיקים: ${imageSync.warnings.join(' | ')}`;
      } catch (error) {
        assertCurrent();
        if (scopeChanged(error)) throw error;
        imageSyncWarning = `תמונות שיקים לא סונכרנו לענן: ${(record(error) ? error.message : null) || error}`;
      }
      const verified = await archive.read(
        [
          { role: 'business', accountKey: String(businessAccount || '') },
          ...(home && homeAccount
            ? [{ role: /** @type {const} */ ('home'), accountKey: String(homeAccount) }]
            : []),
        ],
        { days: 370, assertCurrent }
      );
      const first = verified[0];
      if (!first) throw new Error('bank_archive_read_required');
      const businessArchive = first.rows,
        businessDirect = first.directSnapshot;
      const homeArchive = verified[1]?.rows || [],
        homeDirect = verified[1]?.directSnapshot ?? null;
      assertCurrent();
      const assertReadable = authority.captureRead();
      const archiveCandidate = {
        business: {
          accountKey: String(businessAccount || ''),
          syncKey: String(fetchedAt),
          rows: businessArchive,
          directSnapshot: businessDirect,
          assertCurrent: assertReadable,
        },
        ...(homeAccount
          ? {
              home: {
                accountKey: String(homeAccount),
                syncKey: String(fetchedAt),
                rows: homeArchive,
                directSnapshot: homeDirect,
                assertCurrent: assertReadable,
              },
            }
          : {}),
      };
      const requireExactArchive = historyDays >= 365,
        businessAudit = verifyBankArchiveCoverage(businessMerge, businessArchive, {
          role: 'עסקי',
          requireExactCount: requireExactArchive,
        }),
        homeAudit =
          home && homeAccount
            ? verifyBankArchiveCoverage(homeMerge, homeArchive, {
                role: 'ביתי',
                requireExactCount: requireExactArchive,
              })
            : null,
        archiveAudit = {
          version: 3,
          verifiedAt: fetchedAt,
          historyDays,
          business: {
            ...businessAudit,
            accountKey: businessAccount,
            reconciliation: (record(businessMerge) ? businessMerge.result : null) || null,
            coverage: businessCoverage,
          },
          home: homeAudit
            ? {
                ...homeAudit,
                accountKey: homeAccount,
                reconciliation: (record(homeMerge) ? homeMerge.result : null) || null,
                coverage: homeCoverage,
              }
            : null,
        };
      return {
        businessAccount,
        homeAccount,
        businessCoverage,
        homeCoverage,
        businessArchive,
        homeArchive,
        archiveCandidate,
        archiveAudit,
        imageSyncWarning,
      };
    } catch (error) {
      assertCurrent();
      throw error;
    }
  }
  /** @type {ReconciliationCapability['commands']} */ const commands = {
    sync: (options) => work.run(() => sync(options)),
  };
  return Object.freeze({
    commands: Object.freeze(commands),
    runtime: Object.freeze({ isPending: work.isPending, drain: work.drain, dispose: work.close }),
  });
}
