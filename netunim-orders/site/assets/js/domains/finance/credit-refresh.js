// @ts-check
import { createRuntimeTaskOwner } from '../../shared/runtime-task-owner.js';
import {
  readCreditRefreshResult,
  readCreditStatusProfiles,
  readCreditFailureIssues,
  creditIssuesDeferred,
  creditRefreshScopeChanged,
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
/** @typedef {{saved?:boolean,skipped?:boolean,publicationWarning?:string}} Publication */
/** @typedef {{
 * interactive?:boolean,auto?:boolean,syncMode?:string,isCurrent?:()=>boolean,
 * onDenied:()=>undefined,
 * onDeferred:()=>undefined,
 * onWarning:(warning:string)=>undefined,
 * onPublished:(saved:Publication,result:Result,deferredOnly:boolean)=>undefined,
 * onFailed:(error:unknown,deferredOnly:boolean,epoch:number)=>undefined,
 * onDiagnosticsWarning:(warning:string)=>undefined,
 * onDiagnosticsFailed:(error:unknown,epoch:number)=>undefined,
 * onFailureFinished:(deferredOnly:boolean)=>undefined
 * }} RefreshRequest */
/** @typedef {{
 * authority:{capture:()=>Guard},
 * cloud:{refresh:(options:{force:true,renderIfChanged:true,assertCurrent:Guard})=>Promise<boolean>,readSync:()=>unknown},
 * device:{capture:()=>Guard,readStatus:()=>Promise<unknown>,supported:(status:unknown)=>boolean,sync:(options:{interactive:boolean,syncMode:string,selection:unknown})=>Promise<unknown>,refreshStatus:(options:{quiet:true})=>Promise<unknown>,reportFailure:(error:unknown)=>unknown},
 * leases:CreditLeases,
 * policy:CreditPolicy,
 * publication:{commit:(mutator:(state:State)=>State|null,lease:Lease|null)=>Promise<Publication>},
 * automation:{allowed:()=>boolean,currentEpoch:()=>number,due:(stamp:unknown)=>boolean,mode:()=>unknown}
 * }} RefreshPorts */
/** @typedef {{commands:{refresh:(request:RefreshRequest)=>Promise<boolean>},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} CreditRefreshCapability */
/** @param {RefreshPorts} ports @returns {CreditRefreshCapability} */
export function createOrdersCreditRefresh({
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
      [
        'capture',
        'readStatus',
        'supported',
        'sync',
        'refreshStatus',
        'reportFailure'
      ]
    ],
    ['leases', leases, ['createToken', 'reportFailure']],
    ['lease_commands', leases?.commands, ['acquire']],
    ['lease_runtime', leases?.runtime, ['isPending', 'drain', 'dispose']],
    [
      'policy',
      policy,
      ['normalizeMode', 'resolveMode', 'selection', 'merge', 'lastSyncAt']
    ],
    ['publication', publication, ['commit']],
    ['automation', automation, ['allowed', 'currentEpoch', 'due', 'mode']]
  ]);
  const work = createRuntimeTaskOwner();
  /** @returns {undefined} */
  function active() {
    if (!work.isActive())
      throw Object.assign(new Error('credit_disposed'), {
        code: 'FINANCE_OPERATION_SCOPE_CHANGED'
      });
  }
  /** @param {RefreshRequest} request @returns {Promise<boolean>} */
  async function runRefresh({
    interactive = false,
    auto = false,
    syncMode = 'forecast',
    isCurrent = () => true,
    onDenied,
    onDeferred,
    onWarning,
    onPublished,
    onFailed,
    onDiagnosticsWarning,
    onDiagnosticsFailed,
    onFailureFinished
  }) {
    /** @type {Lease|null} */ let lease = null;
    /** @type {Session|null} */ let leaseSession = null;
    /** @type {Guard|undefined} */ let assertOwner;
    /** @type {Guard|undefined} */ let assertConnection;
    const schedulerEpoch = automation.currentEpoch();
    /** @type {Guard} */ const assertCurrent = () => {
      active();
      assertOwner?.();
      assertConnection?.();
      leaseSession?.assertCurrent();
    };
    try {
      assertOwner = authority.capture();
      assertConnection = device.capture();
      const cloudFresh = await cloud.refresh({
        force: true,
        renderIfChanged: true,
        assertCurrent
      });
      assertCurrent();
      if (auto && !cloudFresh)
        throw new Error('לא ניתן לאמת את זמן סנכרון האשראי המשותף בענן');
      if (auto && !automation.due(policy.lastSyncAt(cloud.readSync())))
        return true;
      if (auto && (!isCurrent() || !automation.allowed())) return false;
      leaseSession = leases.commands.acquire('credit', leases.createToken(), {
        assertCurrent: () => {
          assertOwner?.();
          assertConnection?.();
        }
      });
      lease = await leaseSession.ready;
      assertCurrent();
      lease = { ...lease, assertCurrent };
      if (!lease.acquired) {
        onDenied();
        return false;
      }
      if (auto) {
        const confirmed = await cloud.refresh({
          force: true,
          renderIfChanged: true,
          assertCurrent
        });
        assertCurrent();
        if (!confirmed)
          throw new Error(
            'לא ניתן לאמת מחדש את זמן סנכרון האשראי לאחר תפיסת הנעילה'
          );
        if (!automation.due(policy.lastSyncAt(cloud.readSync()))) return true;
      }
      const status = await device.readStatus();
      assertCurrent();
      if (!device.supported(status))
        throw new Error('יש לשדרג את Bank Bridge לפני סנכרון האשראי');
      const profiles = readCreditStatusProfiles(status);
      if (!profiles.length)
        throw new Error('לא הוגדר עדיין חיבור לחברת אשראי במחשב זה');
      const requestedMode = auto
        ? policy.resolveMode(automation.mode(), cloud.readSync(), {
            profileIds: profiles.map(profile => profile.profileId)
          })
        : policy.normalizeMode(syncMode, 'forecast');
      if (auto && (!isCurrent() || !automation.allowed())) return false;
      const result = readCreditRefreshResult(
        await device.sync({
          interactive,
          syncMode: requestedMode,
          selection: policy.selection(cloud.readSync())
        })
      );
      assertCurrent();
      if (
        Number(result.attemptedCount) === 0 &&
        Number(result.deferredCount) > 0
      ) {
        await device.refreshStatus({ quiet: true });
        assertCurrent();
        onDeferred();
        return true;
      }
      const saved = await publication.commit(finance => {
        if (auto && !automation.due(policy.lastSyncAt(finance.creditSync)))
          return null;
        finance.creditSync = policy.merge(finance.creditSync, result);
        return finance;
      }, lease);
      await device.refreshStatus({ quiet: true });
      assertCurrent();
      if (saved.publicationWarning) {
        onWarning(saved.publicationWarning);
        return true;
      }
      const deferredOnly = creditIssuesDeferred(result.errors || []);
      onPublished(saved, result, deferredOnly);
      return true;
    } catch (error) {
      try {
        active();
        assertOwner?.();
        assertConnection?.();
      } catch (ownerError) {
        error = ownerError;
      }
      device.reportFailure(error);
      const issues = readCreditFailureIssues(error),
        deferredOnly = creditIssuesDeferred(issues);
      onFailed(error, deferredOnly, schedulerEpoch);
      if (issues.length) {
        try {
          assertCurrent();
          const diagnostics = await publication.commit(finance => {
            finance.creditSync = policy.merge(finance.creditSync, {
              profiles: [],
              errors: issues
            });
            return finance;
          }, lease);
          if (diagnostics.publicationWarning)
            onDiagnosticsWarning(diagnostics.publicationWarning);
        } catch (persistError) {
          onDiagnosticsFailed(persistError, schedulerEpoch);
          return false;
        }
      }
      onFailureFinished(deferredOnly);
      return deferredOnly;
    } finally {
      try {
        await leaseSession?.close();
      } catch (error) {
        if (!creditRefreshScopeChanged(error)) leases.reportFailure(error);
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
