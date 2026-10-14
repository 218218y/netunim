// @ts-check
import { createRuntimeTaskOwner } from '../../shared/runtime-task-owner.js';
import {
  readCreditRefreshResult,
  readCreditStatusProfiles,
  readCreditFailureIssues,
  creditIssuesDeferred,
  creditRefreshRecord
} from '../../shared/credit-refresh-result.js';
/** @typedef {()=>undefined} Guard */
/** @typedef {import('../../shared/finance-lease-owner.js').OperationLease} Lease */
/** @typedef {import('../../shared/finance-lease-owner.js').LeaseSession} Session */
/** @typedef {import('../../shared/credit-refresh-result.js').CreditRefreshResult} Result */
/** @typedef {import('../../shared/credit-refresh-result.js').CreditIssue} Issue */
/** @typedef {Record<string,unknown>} State */
/** @typedef {{
 * normalizeMode:(mode:unknown,fallback:'forecast')=>string,resolveMode:(mode:unknown,sync:unknown,options:{profileIds:string[]})=>string,selection:(sync:unknown)=>unknown,merge:(sync:unknown,result:Result)=>State,lastSyncAt:(sync:unknown)=>unknown
 * }} CreditPolicy */
/** @typedef {{
 * commands:{acquire:(name:'credit',token:string,options:{assertCurrent:Guard})=>Session},
 * runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean},createToken:()=>string,reportFailure:(error:unknown)=>undefined
 * }} CreditLeases */
/** @param {Array<[string,unknown,string[]]>} required */
function requirePorts(required) {
  for (const [name, port, methods] of required)
    for (const method of methods)
      if (!creditRefreshRecord(port) || typeof port[method] !== 'function')
        throw new TypeError(
          'credit_refresh_' + name + '_' + method + '_required'
        );
}
/** @typedef {{
 * interactive?:boolean,auto?:boolean,syncMode?:string,allowed:()=>boolean,
 * onDenied:()=>undefined,
 * onDeferred:()=>undefined,
 * onPublished:(result:Result,deferredOnly:boolean)=>undefined,
 * onFailed:(error:unknown,deferredOnly:boolean)=>undefined,
 * onDiagnosticsFailed:(error:unknown)=>undefined,
 * onFailureFinished:(deferredOnly:boolean)=>undefined
 * }} RefreshRequest */
/** @typedef {{
 * authority:{capture:()=>Guard},
 * cloud:{refresh:(options:{assertCurrent:Guard})=>Promise<{verified:boolean,state?:State|null}>,readSync:()=>unknown},
 * device:{capture:()=>Guard,status:()=>unknown,error:()=>string,supported:(status:unknown)=>boolean,sync:(options:{interactive:boolean,syncMode:string,selection:unknown})=>Promise<unknown>,refreshStatus:()=>Promise<unknown>},
 * leases:CreditLeases,
 * policy:CreditPolicy,
 * publication:{publish:(candidate:State,message:string,lease:Lease|null,assertCurrent:Guard|undefined,assertRetained:Guard|undefined)=>Promise<unknown>},
 * automation:{due:(stamp:unknown)=>boolean,mode:()=>unknown,markAttempt:()=>boolean}
 * }} RefreshPorts */
/** @typedef {{commands:{refresh:(request:RefreshRequest)=>Promise<boolean|undefined>},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} CreditRefreshCapability */
/** @param {RefreshPorts} ports @returns {CreditRefreshCapability} */
export function createKupaCreditRefresh({
  authority,
  cloud,
  device,
  leases,
  policy,
  publication,
  automation
}) {
  requirePorts([
    ['authority', authority, ['capture']],
    ['cloud', cloud, ['refresh', 'readSync']],
    [
      'device',
      device,
      ['capture', 'status', 'error', 'supported', 'sync', 'refreshStatus']
    ],
    ['leases', leases, ['createToken', 'reportFailure']],
    ['lease_commands', leases?.commands, ['acquire']],
    ['lease_runtime', leases?.runtime, ['isPending', 'drain', 'dispose']],
    [
      'policy',
      policy,
      ['normalizeMode', 'resolveMode', 'selection', 'merge', 'lastSyncAt']
    ],
    ['publication', publication, ['publish']],
    ['automation', automation, ['due', 'mode', 'markAttempt']]
  ]);
  const work = createRuntimeTaskOwner();
  /** @returns {undefined} */
  function active() {
    if (!work.isActive())
      throw Object.assign(new Error('credit_disposed'), {
        code: 'FINANCE_OPERATION_SCOPE_CHANGED'
      });
  }
  /** @param {RefreshRequest} request @returns {Promise<boolean|undefined>} */
  async function runRefresh({
    interactive = false,
    auto = false,
    syncMode = 'forecast',
    allowed,
    onDenied,
    onDeferred,
    onPublished,
    onFailed,
    onDiagnosticsFailed,
    onFailureFinished
  }) {
    /** @type {Lease|null} */ let lease = null;
    /** @type {Session|null} */ let leaseSession = null;
    let autoCreditSync = cloud.readSync();
    /** @type {Guard|undefined} */ let assertCurrent;
    /** @type {Guard|undefined} */ let assertOwner;
    /** @type {Guard|undefined} */ let assertRetained;
    try {
      const assertConnection = device.capture();
      assertOwner = authority.capture();
      assertRetained = () => {
        active();
        assertOwner?.();
        assertConnection();
      };
      assertCurrent = () => {
        assertRetained?.();
        leaseSession?.assertCurrent();
      };
      if (auto) {
        const latest = await cloud.refresh({ assertCurrent });
        assertCurrent();
        if (!allowed()) return false;
        if (!latest?.verified) {
          if (!automation.markAttempt()) return false;
          throw new Error('לא ניתן לאמת את זמן סנכרון האשראי המשותף בענן');
        }
        autoCreditSync = latest.state?.creditSync || autoCreditSync;
        if (!automation.due(policy.lastSyncAt(autoCreditSync)))
          return automation.markAttempt();
        if (!automation.markAttempt()) return false;
      }
      leaseSession = leases.commands.acquire('credit', leases.createToken(), {
        assertCurrent: () => {
          assertOwner?.();
          assertConnection();
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
      if (auto) {
        const latest = await cloud.refresh({ assertCurrent });
        assertCurrent();
        if (!allowed()) return false;
        if (!latest?.verified)
          throw new Error(
            'לא ניתן לאמת מחדש את זמן סנכרון האשראי לאחר תפיסת הנעילה'
          );
        autoCreditSync = latest.state?.creditSync || autoCreditSync;
        if (!automation.due(policy.lastSyncAt(autoCreditSync))) return true;
      }
      const status = device.status() || (await device.refreshStatus());
      assertCurrent();
      if (auto && !allowed()) return false;
      if (!status) throw new Error(device.error() || 'Bank Bridge אינו זמין');
      if (!device.supported(status))
        throw new Error('יש לשדרג את Bank Bridge לפני סנכרון אשראי');
      const profiles = readCreditStatusProfiles(status);
      if (!profiles.length)
        throw new Error('לא הוגדר עדיין חיבור לחברת אשראי במחשב זה');
      const requestedMode = auto
        ? policy.resolveMode(automation.mode(), autoCreditSync, {
            profileIds: profiles.map(profile => profile.profileId)
          })
        : policy.normalizeMode(syncMode, 'forecast');
      const selectionSource = auto ? autoCreditSync : cloud.readSync();
      if (auto && !allowed()) return false;
      const result = readCreditRefreshResult(
        await device.sync({
          interactive,
          syncMode: requestedMode,
          selection: policy.selection(selectionSource)
        })
      );
      assertCurrent();
      if (
        Number(result.attemptedCount) === 0 &&
        Number(result.deferredCount) > 0
      ) {
        await device.refreshStatus();
        assertCurrent();
        onDeferred();
        return true;
      }
      const candidate = policy.merge(cloud.readSync(), result);
      const deferredOnly = creditIssuesDeferred(result.errors || []);
      await publication.publish(
        candidate,
        deferredOnly
          ? 'סנכרון האשראי הושהה ו־Last Known Good נשמר'
          : result.errors?.length
            ? 'האשראי עודכן עם אזהרות ונשמר מחוץ לגיבויי הקופה'
            : 'האשראי עודכן ונשמר מחוץ לגיבויי הקופה',
        lease,
        assertCurrent,
        assertRetained
      );
      await device.refreshStatus();
      assertCurrent();
      onPublished(result, deferredOnly);
    } catch (e) {
      if (!work.isActive()) return false;
      try {
        assertCurrent?.();
      } catch (scopeError) {
        e = scopeError;
      }
      const issues = readCreditFailureIssues(e),
        deferredOnly = creditIssuesDeferred(issues);
      onFailed(e, deferredOnly);
      // If every local profile failed, the Bridge returns HTTP 400 with structured per-profile errors.
      // Persist those diagnostics without deleting the last successful profile data.
      if (issues.length) {
        try {
          const candidate = policy.merge(cloud.readSync(), {
            profiles: [],
            errors: issues
          });
          await publication.publish(
            candidate,
            'אבחון סנכרון האשראי נשמר; הנתונים התקינים הקודמים נשמרו',
            lease,
            assertCurrent,
            assertRetained
          );
        } catch (error) {
          onDiagnosticsFailed(error);
        }
      }
      onFailureFinished(deferredOnly);
    } finally {
      // A former account's lease expires by TTL; never release it using a new login.
      try {
        await leaseSession?.close();
      } catch (error) {
        if (
          !creditRefreshRecord(error) ||
          error.code !== 'FINANCE_OPERATION_SCOPE_CHANGED'
        )
          leases.reportFailure(error);
      }
    }
  }
  /** @param {RefreshRequest} request @returns {Promise<boolean|undefined>} */
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
