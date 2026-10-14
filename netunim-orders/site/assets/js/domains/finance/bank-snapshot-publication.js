// @ts-check
import { createRuntimeTaskOwner } from '../../shared/runtime-task-owner.js';
import { readBankBalanceResult } from '../../shared/bank-balance-result.js';
import { FINANCE_PUBLICATION_WARNING } from './document-publication.js';

/** @typedef {() => undefined} SnapshotGuard */
/** @typedef {import('../../shared/bank-balance-result.js').BankAccountSnapshot} BankAccount */
/** @typedef {import('./bank-archive-readout.js').ArchiveCandidate<unknown>} ArchiveCandidate */
/** @typedef {import('./bank-archive-readout.js').ArchiveRead<unknown>} ArchiveRead */
/** @typedef {{leaseName:'bank',leaseToken:string,fenceEpoch:number,assertCurrent:SnapshotGuard}&Record<string,unknown>} SnapshotLease */
/** @typedef {{financeRow:unknown,historyDays:number,lease:SnapshotLease,archiveReady:boolean,archiveVersion:number}} SnapshotRequest */
/** @typedef {{complete:boolean,from:string|null,to:string|null,days:number|null,warning:string}} TransactionCoverage */
/** @typedef {{kupa:unknown,bankEvents:unknown}} ChecksState */
/** @typedef {{bank:Record<string,unknown>,snapshotToken:string,snapshotSeq:number}} SnapshotPlan */
/** @typedef {{business:BankAccount,businessAccount:unknown,home:BankAccount|null,homeFailure:unknown,fetchedAt:unknown,businessArchive:readonly unknown[],homeArchive:readonly unknown[],financeRow:unknown,historyDays:number,archiveReady:boolean,archiveVersion:number,archiveAudit:unknown,businessCoverage:TransactionCoverage,homeCoverage:TransactionCoverage|null,checksState:ChecksState}} PlanInput */
/** @typedef {{lastScrapeAt:unknown,lastError:string,lastErrorAt:null,lastWarning:string,availableAccounts:readonly unknown[],accountRole:string}} ScanPublication */
/** @typedef {{published:boolean,homeFailed:boolean,scan:ScanPublication}} SnapshotPublication */
/** @typedef {{commands:{prepare:(guard:SnapshotGuard)=>Promise<void>,publish:(result:unknown,options:SnapshotRequest)=>Promise<SnapshotPublication>},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} SnapshotCapability */
/** @typedef {{
 * checks:{hasLocalWork:()=>boolean,save:(message:string)=>Promise<unknown>,refresh:(options:{quiet:true,required:true})=>Promise<unknown>,read:()=>ChecksState},
 * transactions:{reconcile:(account:unknown,role:'business'|'home',rows:readonly unknown[],options:{lease:SnapshotLease,snapshotAt:unknown,coverage:TransactionCoverage|null,complete:boolean})=>Promise<unknown>},
 * images:{sync:(rows:readonly unknown[],options:{assertCurrent:SnapshotGuard})=>Promise<{warnings?:readonly unknown[]}|null>},
 * archive:{read:(targets:readonly {role:'business'|'home',accountKey:string}[],options:{days:number,assertCurrent:SnapshotGuard})=>Promise<ArchiveRead[]>,publish:(candidate:ArchiveCandidate)=>boolean},
 * publication:{save:(bank:Record<string,unknown>,token:string,seq:number,lease:SnapshotLease)=>Promise<{published:boolean}>},
 * policy:{accountId:(snapshot:BankAccount)=>unknown,coverage:(snapshot:BankAccount)=>TransactionCoverage,transactions:(snapshot:BankAccount)=>readonly unknown[],audit:(merge:unknown,rows:readonly unknown[],options:{role:string,requireExactCount:boolean})=>Record<string,unknown>,build:(input:PlanInput)=>SnapshotPlan},
 * authority:{captureRead:()=>SnapshotGuard}
 * }} SnapshotPorts */

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
 * Own the accepted provider-result -> archive verification -> atomic snapshot
 * sequence. Provider access and lease acquisition remain with the controller;
 * account/device/heartbeat authority accompanies every durable boundary here.
 * @param {SnapshotPorts} ports
 * @returns {SnapshotCapability}
 */
export function createOrdersBankSnapshotPublication({
  checks,
  transactions,
  images,
  archive,
  publication,
  policy,
  authority,
}) {
  /** @type {[string,unknown,string[]][]} */ const required = [
    ['checks', checks, ['hasLocalWork', 'save', 'refresh', 'read']],
    ['transactions', transactions, ['reconcile']],
    ['images', images, ['sync']],
    ['archive', archive, ['read', 'publish']],
    ['publication', publication, ['save']],
    ['policy', policy, ['accountId', 'coverage', 'transactions', 'audit', 'build']],
    ['authority', authority, ['captureRead']],
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
    const { business, home, homeFailure, source } = readBankBalanceResult(result);
    const fetchedAt = source.fetchedAt || new Date().toISOString(),
      businessAccount = policy.accountId(business),
      homeAccount = home ? policy.accountId(home) : '';
    const businessCoverage = policy.coverage(business),
      homeCoverage = home ? policy.coverage(home) : null;
    const businessMerge = await transactions.reconcile(
      businessAccount,
      'business',
      policy.transactions(business),
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
        ? await transactions.reconcile(homeAccount, 'home', policy.transactions(home), {
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
        [...policy.transactions(business), ...(home ? policy.transactions(home) : [])],
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
    if (!first) throw new Error('orders_bank_snapshot_archive_read_required');
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
      businessAudit = policy.audit(businessMerge, businessArchive, {
        role: 'עסקי',
        requireExactCount: requireExactArchive,
      }),
      homeAudit =
        home && homeAccount
          ? policy.audit(homeMerge, homeArchive, {
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
