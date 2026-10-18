// @ts-check
import { createRuntimeTaskOwner } from '../../shared/runtime-task-owner.js';
import { readBankSnapshotResult } from '../../shared/bank-balance-result.js';
import { FINANCE_PUBLICATION_WARNING } from './document-publication.js';

/** @typedef {() => undefined} SnapshotGuard */
/** @typedef {import('../../shared/bank-balance-result.js').BankAccountSnapshot} BankAccount */
/** @typedef {import('./bank-archive-readout.js').ArchiveCandidate<unknown>} ArchiveCandidate */
/** @typedef {{leaseName:'bank',leaseToken:string,fenceEpoch:number,assertCurrent:SnapshotGuard}&Record<string,unknown>} SnapshotLease */
/** @typedef {{financeRow:unknown,historyDays:number,lease:SnapshotLease,archiveReady:boolean,archiveVersion:number}} SnapshotRequest */
/** @typedef {import('../../shared/bank-archive-policy.js').TransactionCoverage} TransactionCoverage */
/** @typedef {{kupa:unknown,bankEvents:unknown}} ChecksState */
/** @typedef {{bank:Record<string,unknown>,snapshotToken:string,snapshotSeq:number}} SnapshotPlan */
/** @typedef {{business:BankAccount,businessAccount:unknown,home:BankAccount|null,homeFailure:unknown,fetchedAt:unknown,businessArchive:readonly unknown[],homeArchive:readonly unknown[],financeRow:unknown,historyDays:number,archiveReady:boolean,archiveVersion:number,archiveAudit:unknown,businessCoverage:TransactionCoverage,homeCoverage:TransactionCoverage|null,checksState:ChecksState}} PlanInput */
/** @typedef {{lastScrapeAt:unknown,lastError:string,lastErrorAt:null,lastWarning:string,availableAccounts:readonly unknown[],accountRole:string}} ScanPublication */
/** @typedef {{published:boolean,homeFailed:boolean,scan:ScanPublication}} SnapshotPublication */
/** @typedef {{commands:{prepare:(guard:SnapshotGuard)=>Promise<void>,publish:(result:unknown,options:SnapshotRequest)=>Promise<SnapshotPublication>},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} SnapshotCapability */
/** @typedef {{
 * checks:{hasLocalWork:()=>boolean,save:(message:string)=>Promise<unknown>,refresh:(options:{quiet:true,required:true})=>Promise<unknown>,read:()=>ChecksState},
 * archive:{publish:(candidate:ArchiveCandidate)=>boolean},
 * reconciliation:import('../../shared/bank-archive-reconciliation.js').ReconciliationCapability,
 * publication:{save:(bank:Record<string,unknown>,token:string,seq:number,lease:SnapshotLease)=>Promise<{published:boolean}>},
 * policy:{build:(input:PlanInput)=>SnapshotPlan}
 * }} SnapshotPorts */

/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/**
 * Own the accepted provider-result -> archive verification -> atomic snapshot
 * sequence. Provider access and lease acquisition belong to the refresh owner;
 * account/device/heartbeat authority accompanies every durable boundary here.
 * @param {SnapshotPorts} ports
 * @returns {SnapshotCapability}
 */
export function createOrdersBankSnapshotPublication({
  checks,
  archive,
  reconciliation,
  publication,
  policy,
}) {
  /** @type {[string,unknown,string[]][]} */ const required = [
    ['checks', checks, ['hasLocalWork', 'save', 'refresh', 'read']],
    ['archive', archive, ['publish']],
    ['reconciliation', reconciliation?.commands, ['sync']],
    ['publication', publication, ['save']],
    ['policy', policy, ['build']],
  ];
  for (const [name, port, methods] of required)
    for (const method of methods)
      if (typeof (/** @type {Record<string,unknown>} */ (port)?.[method]) !== 'function')
        throw new TypeError('orders_bank_snapshot_' + name + '_' + method + '_required');
  const work = createRuntimeTaskOwner(),
    publicationWarning = FINANCE_PUBLICATION_WARNING;
  /** @returns {undefined} */
  function active() {
    if (!work.isActive())
      throw Object.assign(new Error('orders_bank_snapshot_disposed'), {
        code: 'FINANCE_OPERATION_SCOPE_CHANGED',
      });
  }

  /** @param {SnapshotGuard} assertCurrent @returns {Promise<void>} */
  async function prepareBankSnapshot(assertCurrent) {
    assertCurrent();
    if (checks.hasLocalWork()) {
      const saved = await checks.save('הצ׳קים סונכרנו לפני צילום יתרת הבנק');
      assertCurrent();
      if (!saved || checks.hasLocalWork())
        throw new Error('יש להמתין לסנכרון הצ׳קים לפני צילום יתרת עו״ש חדש');
    }
    const synced = await checks.refresh({ quiet: true, required: true });
    assertCurrent();
    if (!synced) throw new Error('צילום היתרה נעצר: לא ניתן לאמת שהצ׳קים מסונכרנים כרגע');
    if (checks.hasLocalWork()) {
      const saved = await checks.save('הצ׳קים סונכרנו לפני צילום יתרת הבנק');
      assertCurrent();
      if (!saved || checks.hasLocalWork())
        throw new Error('יש להמתין לסנכרון הצ׳קים לפני צילום יתרת עו״ש חדש');
    }
  }

  /** @param {unknown} result @param {SnapshotRequest} options @returns {Promise<SnapshotPublication>} */
  async function publish(result, { financeRow, historyDays, lease, archiveReady, archiveVersion }) {
    const assertLease = lease.assertCurrent;
    /** @type {SnapshotGuard} */
    const assertCurrent = () => {
      active();
      assertLease();
    };
    assertCurrent();
    lease = { ...lease, assertCurrent };
    const { business, home, homeFailure, source } = readBankSnapshotResult(result);
    const fetchedAt = source.fetchedAt;
    const {businessAccount,businessCoverage,homeCoverage,businessArchive,homeArchive,archiveCandidate,archiveAudit,imageSyncWarning}=await reconciliation.commands.sync({business,home,fetchedAt,historyDays,lease});assertCurrent();
    await prepareBankSnapshot(assertCurrent);
    assertCurrent();
    if (checks.hasLocalWork())
      throw new Error('הצקים השתנו לפני השמירה. יש להמתין לסנכרון ולנסות שוב.');
    const { bank, snapshotToken, snapshotSeq } = policy.build({
      business,
      businessAccount,
      home,
      homeFailure,
      fetchedAt,
      businessArchive,
      homeArchive,
      financeRow,
      historyDays,
      archiveReady,
      archiveVersion,
      archiveAudit,
      businessCoverage,
      homeCoverage,
      checksState: checks.read(),
    });
    const saved = await publication.save(bank, snapshotToken, snapshotSeq, lease);
    assertCurrent();
    const readoutVerified = saved.published === true;
    if (readoutVerified) archive.publish(archiveCandidate);
    const failure = record(homeFailure) ? homeFailure : null;
    const scan = {
      lastScrapeAt: fetchedAt,
      lastError: '',
      lastErrorAt: null,
      lastWarning: [
        business?.transactionWarning ? `עסקי: ${business.transactionWarning}` : '',
        home?.transactionWarning ? `ביתי: ${home.transactionWarning}` : '',
        failure?.message ? `ביתי: ${failure.message}` : '',
        imageSyncWarning,
        !readoutVerified ? publicationWarning : '',
      ]
        .filter(Boolean)
        .join(' | '),
      availableAccounts: Array.isArray(failure?.availableAccounts) ? failure.availableAccounts : [],
      accountRole: homeFailure ? 'home' : '',
    };
    return { published: readoutVerified, homeFailed: !!homeFailure, scan };
  }
  /** @type {SnapshotCapability['commands']} */
  const commands = {
    prepare: (guard) =>
      work.run(() =>
        prepareBankSnapshot(() => {
          active();
          guard();
        })
      ),
    publish: (result, options) => work.run(() => publish(result, options)),
  };
  return Object.freeze({
    commands: Object.freeze(commands),
    runtime: Object.freeze({ isPending: work.isPending, drain: work.drain, dispose: work.close }),
  });
}
