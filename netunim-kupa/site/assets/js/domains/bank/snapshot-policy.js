// @ts-check
import {
  bankArchiveAccountId as accountIdOf,
  bankTransactionCoverage as completeTransactionCoverage
} from '../../shared/bank-archive-policy.js';
import { bankSnapshotFinancials } from '../../shared/bank-balance-result.js';
/** @typedef {Record<string,unknown>} Bank */
/** @typedef {import('../../shared/bank-balance-result.js').BankAccountSnapshot} Account */
/** @typedef {{business:Account,home:Account|null,homeFailure:Readonly<Record<string,unknown>>|null,fetchedAt:unknown,businessAccount:unknown,businessArchive:readonly unknown[],homeArchive:readonly unknown[],archiveAudit:unknown,imageSyncWarning:string,cloudArchive:boolean,historyDays:number,archiveReady:boolean,archiveVersion:number}} CandidateRequest */
/** @typedef {CandidateRequest & {businessFeed:Bank|null,homeFeed:Bank|null,warnings:string[],previousBank:Bank,exactBackfillVerified:boolean,archiveBaselineAudit:unknown}} PreparedCandidate */
/** @typedef {{feeds:{normalize:(value:Bank)=>Bank,recurringHistory:(previous:unknown,feed:Bank,role:string,coverage:import('../../shared/bank-archive-policy.js').TransactionCoverage)=>unknown,roundMoney:(value:number)=>number},source:{readBank:()=>Bank,observedSequence:()=>number},identity:{now:()=>string,today:()=>string,createToken:()=>string}}} PolicyPorts */
/** @typedef {import('./snapshot-commands.js').BankSnapshot & import('../../shared/bank-balance-result.js').BankSnapshotFinancials & {currentBalance:number,updatedAt:string,asOfDate:string,source:'hapoalim'}} BankCandidate */
/** @typedef {{prepare:(request:CandidateRequest)=>PreparedCandidate,build:(candidate:PreparedCandidate)=>BankCandidate}} BankSnapshotPolicy */
// Pure candidate policy: no provider, lease, persistence or display authority.
// Capture prior feeds/audit before the Checks barrier; stamps and the observed
// watermark are captured only while building after that barrier.
/** @param {PolicyPorts} ports @returns {BankSnapshotPolicy} */
export function createKupaBankSnapshotPolicy({ feeds, source, identity }) {
  for (const [
    name,
    port,
    methods
  ] of /** @type {Array<[string,unknown,string[]]>} */ ([
    ['feeds', feeds, ['normalize', 'recurringHistory', 'roundMoney']],
    ['source', source, ['readBank', 'observedSequence']],
    ['identity', identity, ['now', 'today', 'createToken']]
  ]))
    for (const method of methods)
      if (
        typeof (/** @type {Record<string,unknown>} */ (port)?.[method]) !==
        'function'
      )
        throw new TypeError(
          'kupa_bank_policy_' + name + '_' + method + '_required'
        );
  /** @param {Bank|null} snapshot @param {unknown} fetchedAt @param {'business'|'home'} role @returns {Bank|null} */
  function feedFromSnapshot(snapshot, fetchedAt, role) {
    if (!snapshot || !Number.isFinite(Number(snapshot.balance))) return null;
    const feed = feeds.normalize({
      provider: 'hapoalim',
      accountNumber: accountIdOf(snapshot),
      balance: Number(snapshot.balance),
      availableBalance: snapshot.availableBalance,
      creditLimit: snapshot.creditLimit,
      creditLimitUsed: snapshot.creditLimitUsed,
      creditLimitUsedPercent: snapshot.creditLimitUsedPercent,
      syncedAt: fetchedAt,
      transactions: snapshot.transactions || [],
      transactionWarning: snapshot.transactionWarning || ''
    });
    const previous =
      role === 'home' ? source.readBank().homeFeed : source.readBank().feed;
    feed.recurringDebitHistory = feeds.recurringHistory(
      previous,
      feed,
      role,
      completeTransactionCoverage(snapshot)
    );
    return feed;
  }
  /** @param {CandidateRequest} options @returns {PreparedCandidate} */
  function prepare(options) {
    const {
      business,
      home,
      homeFailure,
      fetchedAt,
      businessArchive,
      homeArchive,
      archiveAudit,
      imageSyncWarning,
      cloudArchive,
      historyDays
    } = options;
    const businessFeed = feedFromSnapshot(
        { ...business, transactions: businessArchive },
        fetchedAt,
        'business'
      ),
      homeFeed = home
        ? feedFromSnapshot(
            { ...home, transactions: homeArchive },
            fetchedAt,
            'home'
          )
        : null;
    const warnings = [
      business?.transactionWarning
        ? `עסקי: ${business.transactionWarning}`
        : '',
      home?.transactionWarning ? `ביתי: ${home.transactionWarning}` : '',
      homeFailure?.message ? `ביתי: ${homeFailure.message}` : '',
      imageSyncWarning
    ].filter(Boolean);
    const previousBank = source.readBank();
    const exactBackfillVerified =
        cloudArchive &&
        historyDays >= 365 &&
        completeTransactionCoverage(business).complete &&
        !homeFailure &&
        (!home || completeTransactionCoverage(home).complete),
      archiveBaselineAudit = exactBackfillVerified
        ? archiveAudit
        : previousBank.archiveBaselineAudit || null;

    return {
      ...options,
      businessFeed,
      homeFeed,
      warnings,
      previousBank,
      exactBackfillVerified,
      archiveBaselineAudit
    };
  }
  /** @param {PreparedCandidate} options @returns {BankCandidate} */
  function build(options) {
    const {
      business,
      businessAccount,
      home,
      homeFailure,
      fetchedAt,
      businessFeed,
      homeFeed,
      previousBank,
      cloudArchive,
      archiveReady,
      archiveVersion,
      exactBackfillVerified,
      archiveAudit,
      archiveBaselineAudit
    } = options;
    return {
      ...previousBank,
      currentBalance: feeds.roundMoney(business.balance),
      ...bankSnapshotFinancials(business),
      updatedAt: identity.now(),
      asOfDate: identity.today(),
      snapshotToken: identity.createToken(),
      snapshotSeq: source.observedSequence(),
      adjustments: [],
      source: 'hapoalim',
      sourceAccount: businessAccount || null,
      bankSyncAt: fetchedAt,
      feed: businessFeed,
      homeFeed: home
        ? homeFeed
        : homeFailure
          ? (previousBank.homeFeed ?? null)
          : null,
      archiveInitialized: cloudArchive
        ? archiveReady || exactBackfillVerified
        : previousBank.archiveInitialized === true,
      archiveVersion: exactBackfillVerified ? 2 : archiveVersion,
      archiveInitializedAt: cloudArchive
        ? archiveReady
          ? previousBank.archiveInitializedAt || null
          : exactBackfillVerified
            ? fetchedAt
            : null
        : previousBank.archiveInitializedAt || null,
      archiveAudit: cloudArchive
        ? archiveAudit
        : previousBank.archiveAudit || null,
      archiveBaselineAudit: cloudArchive
        ? archiveBaselineAudit
        : previousBank.archiveBaselineAudit || null
    };
  }
  return Object.freeze({ prepare, build });
}
