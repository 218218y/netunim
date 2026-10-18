// @ts-check
import { createRuntimeTaskOwner } from '../../shared/runtime-task-owner.js';
import { readBankSnapshotResult } from '../../shared/bank-balance-result.js';
import { bankArchiveAccountId as accountIdOf } from '../../shared/bank-archive-policy.js';
/** @typedef {()=>undefined} Guard */
/** @typedef {import('../../shared/finance-lease-owner.js').OperationLease} Lease */
/** @typedef {import('../../shared/finance-lease-owner.js').LeaseSession} Session */
/** @typedef {Record<string,unknown>} State */
/** @typedef {import('./snapshot-commands.js').SnapshotLease} CloudLease */
/** @typedef {import('./snapshot-commands.js').BankSnapshot} Snapshot */
/** @typedef {import('../../shared/bank-archive-reconciliation.js').ArchiveCandidate} Archive */
/** @typedef {import('./snapshot-policy.js').BankSnapshotPolicy} SnapshotPolicy */
/** @typedef {Pick<import('./snapshot-policy.js').CandidateRequest,'business'|'home'|'homeFailure'|'fetchedAt'> & {warnings:string[],bridgeStatus:State,assertConnection:Guard}} Published */
/** @typedef {{interactive?:boolean,auto?:boolean,allowed:()=>boolean,onStarted:()=>undefined,onDenied:()=>undefined,onCloudSaved:(historyDays:number)=>undefined,onPublished:(result:Published)=>undefined,onFailed:(error:unknown,connection:Guard|undefined)=>undefined}} RefreshRequest */
/** @typedef {{
 * authority:{capture:()=>Guard},
 * cloud:{mode:()=>string,refresh:(options:{assertCurrent:Guard})=>Promise<{verified:boolean,state?:State|null}>,currentState:()=>State,lastSyncAt:(state:State)=>unknown,checksHaveLocalWork:()=>boolean},
 * device:{capture:()=>Guard,readStatus:()=>Promise<State>,supported:(status:unknown)=>boolean,fetchBalance:(options:{interactive:boolean,historyDays:number})=>Promise<unknown>},
 * leases:{commands:{acquire:(name:'bank',token:string,options:{assertCurrent:Guard})=>Session},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean},createToken:()=>string,reportFailure:(error:unknown)=>undefined},
 * publication:{prepare:(guard:Guard)=>Promise<void>,reconcile:(request:import('../../shared/bank-archive-reconciliation.js').ReconciliationRequest)=>Promise<import('../../shared/bank-archive-reconciliation.js').ArchiveReconciliation>,publishCloud:(bank:Snapshot,candidate:Archive|null,lease:CloudLease)=>Promise<{remoteCommitted:true,readoutVerified:boolean}>,publishLocal:(bank:Snapshot,message:string,guard:Guard)=>Promise<unknown>,readoutWarning:string},
 * policy:SnapshotPolicy,
 * automation:{due:(stamp:unknown)=>boolean,markAttempt:()=>unknown}
 * }} RefreshPorts */
/** @typedef {{commands:{refresh:(request:RefreshRequest)=>Promise<boolean>},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} BankRefreshCapability */
/** @param {unknown} value @returns {value is State} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** @param {unknown} value */
function financeBank(value) {
  const state = record(value) ? value.state : null;
  return record(state) && record(state.bank) ? state.bank : null;
}
/** @param {unknown} error */
function scopeChanged(error) {
  return (
    record(error) &&
    (error.code === 'FINANCE_OPERATION_SCOPE_CHANGED' ||
      error.code === 'BRIDGE_PAIRING_SCOPE_CHANGED')
  );
}
/** @param {unknown} failure @returns {State|null} */
function readHomeFailure(failure) {
  if (!failure) return null;
  if (!record(failure))
    throw Object.assign(
      new Error(
        'Bank Bridge החזיר אבחון ביתי לא תקין; נתוני הבנק הקודמים נשמרו'
      ),
      { code: 'BANK_HOME_FAILURE_INVALID' }
    );
  return failure;
}
/** @param {Lease} lease @returns {CloudLease} */
function requireCloudLease(lease) {
  if (!lease.acquired || 'localOnly' in lease || lease.leaseName !== 'bank')
    throw Object.assign(
      new Error('נדרשת נעילת ענן מאומתת לפני גישה לבנק ושמירת צילום משותף'),
      { code: 'KUPA_BANK_CLOUD_LEASE_REQUIRED' }
    );
  return { ...lease, leaseName: 'bank' };
}
// Owns every accepted preflight/provider/publication/cleanup obligation. The
// snapshot policy calculates candidates; publication retains durable authority.
/** @param {RefreshPorts} ports @returns {BankRefreshCapability} */
export function createKupaBankRefresh({
  authority,
  cloud,
  device,
  leases,
  publication,
  policy,
  automation
}) {
  for (const [
    name,
    port,
    methods
  ] of /** @type {Array<[string,unknown,string[]]>} */ ([
    ['authority', authority, ['capture']],
    [
      'cloud',
      cloud,
      ['mode', 'refresh', 'currentState', 'lastSyncAt', 'checksHaveLocalWork']
    ],
    ['device', device, ['capture', 'readStatus', 'supported', 'fetchBalance']],
    ['leases', leases, ['createToken', 'reportFailure']],
    ['lease_commands', leases?.commands, ['acquire']],
    ['lease_runtime', leases?.runtime, ['isPending', 'drain', 'dispose']],
    [
      'publication',
      publication,
      ['prepare', 'reconcile', 'publishCloud', 'publishLocal']
    ],
    ['policy', policy, ['prepare', 'build']],
    ['automation', automation, ['due', 'markAttempt']]
  ]))
    for (const method of methods)
      if (!record(port) || typeof port[method] !== 'function')
        throw new TypeError(
          'kupa_bank_refresh_' + name + '_' + method + '_required'
        );
  if (
    typeof publication.readoutWarning !== 'string' ||
    !publication.readoutWarning
  )
    throw new TypeError('kupa_bank_refresh_readout_warning_required');
  const work = createRuntimeTaskOwner();
  /** @returns {undefined} */ function active() {
    if (!work.isActive())
      throw Object.assign(new Error('kupa_bank_refresh_disposed'), {
        code: 'FINANCE_OPERATION_SCOPE_CHANGED'
      });
  }
  /** @param {RefreshRequest} request @returns {Promise<boolean>} */
  async function runRefresh({
    interactive = false,
    auto = false,
    allowed,
    onStarted,
    onDenied,
    onCloudSaved,
    onPublished,
    onFailed
  }) {
    /** @type {Lease|null} */ let lease = null;
    /** @type {Session|null} */ let leaseSession = null;
    /** @type {Guard|undefined} */ let assertOwner;
    /** @type {Guard|undefined} */ let assertConnection;
    /** @type {Guard} */ const assertCurrent = () => {
      active();
      assertOwner?.();
      assertConnection?.();
      leaseSession?.assertCurrent();
    };
    try {
      assertOwner = authority.capture();
      assertConnection = device.capture();
      onStarted();
      if (auto) {
        const latest = await cloud.refresh({ assertCurrent });
        assertCurrent();
        if (!allowed()) return false;
        if (!latest?.verified) {
          automation.markAttempt();
          throw new Error('לא ניתן לאמת את זמן סנכרון הבנק המשותף בענן');
        }
        if (
          !automation.due(
            cloud.lastSyncAt(latest.state || cloud.currentState())
          )
        ) {
          automation.markAttempt();
          return true;
        }
        automation.markAttempt();
      }
      leaseSession = leases.commands.acquire('bank', leases.createToken(), {
        assertCurrent: () => {
          assertOwner?.();
          assertConnection?.();
        }
      });
      lease = await leaseSession.ready;
      assertCurrent();
      lease = { ...lease, assertCurrent };
      if (auto && !allowed()) return false;
      if (!lease.acquired) {
        onDenied();
        return false;
      }
      const finance = await cloud.refresh({ assertCurrent });
      assertCurrent();
      if (auto) {
        if (!allowed()) return false;
        if (!finance?.verified)
          throw new Error(
            'לא ניתן לאמת מחדש את זמן סנכרון הבנק לאחר תפיסת הנעילה'
          );
        if (
          !automation.due(
            cloud.lastSyncAt(finance.state || cloud.currentState())
          )
        )
          return true;
      }
      const archiveInitialized =
          financeBank(finance)?.archiveInitialized === true,
        archiveVersion = Number(financeBank(finance)?.archiveVersion || 0),
        archiveReady = archiveInitialized && archiveVersion >= 2;
      const cloudArchive = cloud.mode() === 'supabase',
        historyDays = cloudArchive && !auto && !archiveReady ? 365 : 30;
      const cloudLease = cloudArchive ? requireCloudLease(lease) : null;
      await publication.prepare(assertCurrent);
      assertCurrent();
      if (auto && !allowed()) return false;
      const bridgeStatus = await device.readStatus();
      assertCurrent();
      if (!device.supported(bridgeStatus))
        throw new Error(
          'יש להריץ מחדש install_bank_bridge.bat במחשב זה לפני עדכון מול הבנק'
        );
      const evidence = await device.fetchBalance({ interactive, historyDays });
      assertCurrent();
      const {
        source: result,
        business,
        home,
        homeFailure: failure
      } = readBankSnapshotResult(evidence);
      const homeFailure = readHomeFailure(failure);
      const fetchedAt = result.fetchedAt,
        businessAccount = accountIdOf(business);
      /** @type {readonly unknown[]} */ let businessArchive = Array.isArray(
        business.transactions
      )
        ? business.transactions
        : [];
      /** @type {readonly unknown[]} */ let homeArchive =
        home && Array.isArray(home.transactions) ? home.transactions : [];
      /** @type {unknown} */ let archiveAudit = null;
      let imageSyncWarning = '';
      /** @type {import('../../shared/bank-archive-reconciliation.js').ArchiveCandidate|null} */ let archiveCandidate =
        null;
      if (cloudLease) {
        const reconciled = await publication.reconcile({
          business,
          home,
          fetchedAt,
          historyDays,
          lease: cloudLease
        });
        assertCurrent();
        businessArchive = reconciled.businessArchive;
        homeArchive = reconciled.homeArchive;
        archiveCandidate = reconciled.archiveCandidate;
        archiveAudit = reconciled.archiveAudit;
        imageSyncWarning = reconciled.imageSyncWarning;
      }
      const prepared = policy.prepare({
        business,
        home,
        homeFailure,
        fetchedAt,
        businessAccount,
        businessArchive,
        homeArchive,
        archiveAudit,
        imageSyncWarning,
        cloudArchive,
        historyDays,
        archiveReady,
        archiveVersion
      });
      await publication.prepare(assertCurrent);
      assertCurrent();
      if (cloud.mode() === 'supabase' && cloud.checksHaveLocalWork())
        throw new Error(
          'הצקים השתנו לפני השמירה. יש להמתין לסנכרון ולנסות שוב.'
        );
      const nextBank = policy.build(prepared);
      if (cloud.mode() === 'supabase') {
        const published = await publication.publishCloud(
          nextBank,
          archiveCandidate,
          requireCloudLease(lease)
        );
        assertCurrent();
        if (!published.readoutVerified)
          prepared.warnings.push(publication.readoutWarning);
        onCloudSaved(historyDays);
      } else {
        // An unconfirmed local snapshot outlives this provider's lease session.
        // Retrying remains fenced by component, account/storage and device identity.
        await publication.publishLocal(
          nextBank,
          historyDays >= 365
            ? 'ארכיון הבנק אותחל והופרד מגיבויי הקופה'
            : auto
              ? 'נתוני הבנק עודכנו'
              : 'נתוני הבנק עודכנו ונשמרו בארכיון נפרד',
          () => {
            active();
            assertOwner?.();
            assertConnection?.();
          }
        );
        assertCurrent();
      }
      onPublished({
        business,
        home,
        homeFailure,
        fetchedAt,
        warnings: prepared.warnings,
        bridgeStatus,
        assertConnection
      });
      return true;
    } catch (e) {
      try {
        active();
        assertOwner?.();
        assertConnection?.();
      } catch (scopeError) {
        e = scopeError;
      }
      onFailed(e, assertConnection);
      return false;
    } finally {
      try {
        await leaseSession?.close();
      } catch (error) {
        if (!scopeChanged(error)) leases.reportFailure(error);
      }
    }
  }
  /** @param {RefreshRequest} request @returns {Promise<boolean>} */
  function refresh(request) {
    return work.isActive()
      ? work.run(() => runRefresh(request))
      : Promise.resolve(false);
  }
  const runtime = {
    isPending: () => work.isPending() || leases.runtime.isPending(),
    async drain() {
      do {
        await Promise.all([work.drain(), leases.runtime.drain()]);
      } while (runtime.isPending());
    },
    dispose() {
      if (!work.close()) return false;
      leases.runtime.dispose();
      return true;
    }
  };
  return { commands: { refresh }, runtime };
}
