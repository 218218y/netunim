// @ts-check
import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';

/** @typedef {()=>undefined} Guard */
/** @typedef {import('./bank-snapshot-publication.js').SnapshotPublication} Publication */
/** @typedef {import('./bank-snapshot-publication.js').SnapshotLease & {acquired:boolean}} BankGrant */
/** @typedef {{ready:Promise<BankGrant>,assertCurrent:Guard,close:()=>Promise<void>}} BankSession */
/** @typedef {{interactive?:boolean,auto?:boolean,isCurrent?:()=>boolean,onStarted:()=>undefined,onDenied:()=>undefined,onPublished:(result:Publication)=>undefined,onFailed:(error:unknown,connection:Guard|undefined,schedulerEpoch:number)=>undefined}} RefreshRequest */
/** @typedef {{
 * authority:{capture:()=>Guard},
 * cloud:{refresh:(options:{force:true,renderIfChanged:true,assertCurrent:Guard})=>Promise<boolean>,lastSyncAt:()=>unknown,readFinance:(options:{assertCurrent:Guard})=>Promise<unknown>},
 * device:{capture:()=>Guard,readStatus:()=>Promise<Readonly<Record<string,unknown>>>,supported:(status:unknown)=>boolean,fetchBalance:(options:{interactive:boolean,historyDays:number})=>Promise<unknown>,recordScan:(scan:Publication['scan'],guard:Guard)=>undefined},
 * leases:{commands:{acquire:(name:'bank',token:string,options:{assertCurrent:Guard})=>BankSession},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean},createToken:()=>string,reportFailure:(error:unknown)=>undefined},
 * publication:{prepare:(guard:Guard)=>Promise<void>,publish:(result:unknown,options:import('./bank-snapshot-publication.js').SnapshotRequest)=>Promise<Publication>},
 * automation:{allowed:()=>boolean,currentEpoch:()=>number,due:(stamp:unknown)=>boolean}
 * }} BankRefreshPorts */
/** @typedef {{commands:{refresh:(request:RefreshRequest)=>Promise<boolean>},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} BankRefreshCapability */

/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {unknown} row */
function financeBank(row){const state=record(row)?row.state:null;return record(state)&&record(state.bank)?state.bank:null}
/** @param {unknown} error */
function scopeChanged(error){return record(error)&&(error.code==='FINANCE_OPERATION_SCOPE_CHANGED'||error.code==='CREDIT_CONNECTION_SCOPE_CHANGED'||error.code==='BRIDGE_PAIRING_SCOPE_CHANGED')}
/** @param {unknown} error @param {()=>void} assertOwner */
function currentOperationError(error,assertOwner){try{assertOwner();return error}catch(ownerError){return ownerError}}

// Owns accepted cloud preflight -> lease -> provider -> snapshot -> cleanup.
// Presentation callbacks observe completion; they cannot authorize acquisition
// or reinterpret network payloads. Financial policy stays with publication.
/** @param {BankRefreshPorts} ports @returns {BankRefreshCapability} */
export function createOrdersBankRefresh({authority,cloud,device,leases,publication,automation}){
  const required=/** @type {Array<[string,unknown,string[]]>} */ ([
    ['authority',authority,['capture']],['cloud',cloud,['refresh','lastSyncAt','readFinance']],
    ['device',device,['capture','readStatus','supported','fetchBalance','recordScan']],
    ['leases',leases,['createToken','reportFailure']],['lease_commands',leases?.commands,['acquire']],
    ['lease_runtime',leases?.runtime,['isPending','drain','dispose']],
    ['publication',publication,['prepare','publish']],['automation',automation,['allowed','currentEpoch','due']],
  ]);
  for(const [name,port,methods] of required)for(const method of methods)
    if(!record(port)||typeof port[method]!=='function')throw new TypeError(`orders_bank_refresh_${name}_${method}_required`);
  const work=createRuntimeTaskOwner();
  /** @returns {undefined} */
  function active(){if(!work.isActive())throw Object.assign(new Error('פעולת סנכרון הבנק נסגרה.'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'})}
  /** @param {RefreshRequest} request @returns {Promise<boolean>} */
  async function runRefresh({
    interactive = false, auto = false, isCurrent = () => true,
    onStarted, onDenied, onPublished, onFailed,
  }) {
    /** @type {BankGrant|null} */ let lease = null;
    /** @type {BankSession|null} */ let leaseSession = null;
    /** @type {Guard|undefined} */ let assertOwner;
    /** @type {Guard|undefined} */ let assertConnection;
    const schedulerEpoch = automation.currentEpoch();
    /** @type {Guard} */
    const assertCurrent = () => {
      active();
      assertOwner?.();
      assertConnection?.();
      leaseSession?.assertCurrent()
    };

    try {
      assertOwner = authority.capture();
      assertConnection = device.capture();
      onStarted();
      const cloudFresh = await cloud.refresh({ force: true, renderIfChanged: true, assertCurrent });
      assertCurrent();
      if (auto && !cloudFresh) throw new Error('לא ניתן לאמת את זמן סנכרון הבנק המשותף בענן');
      if (auto && !automation.due(cloud.lastSyncAt())) return true;
      if (auto && (!isCurrent() || !automation.allowed())) return false;
      leaseSession = leases.commands.acquire('bank', leases.createToken(), {
        assertCurrent: () => {
          assertOwner?.();
          assertConnection?.()
        },
      });
      lease = await leaseSession.ready;
      assertCurrent();
      lease = { ...lease, assertCurrent };
      if (!lease.acquired) {
        onDenied();
        return false
      }
      if (auto) {
        const confirmed = await cloud.refresh({ force: true, renderIfChanged: true, assertCurrent });
        assertCurrent();
        if (!confirmed) throw new Error('לא ניתן לאמת מחדש את זמן סינכרון הבנק לאחר תפיסת הנעילה');
        if (!automation.due(cloud.lastSyncAt())) return true
      }
      const status = await device.readStatus();
      assertCurrent();
      if (!device.supported(status)) throw new Error('יש לשדרג את Bank Bridge לפני סנכרון הבנק');
      if (!status.configured) throw new Error('Bank Bridge פעיל אך פרטי בנק הפועלים עדיין לא הוגדרו');
      await publication.prepare(assertCurrent);
      assertCurrent();
      const financeRow = await cloud.readFinance({ assertCurrent });
      assertCurrent();
      const archiveInitialized = financeBank(financeRow)?.archiveInitialized === true,
        archiveVersion = Number(financeBank(financeRow)?.archiveVersion || 0),
        archiveReady = archiveInitialized && archiveVersion >= 2,
        historyDays = !auto && !archiveReady ? 365 : 30;
      if (auto && (!isCurrent() || !automation.allowed())) return false;
      const candidate = await device.fetchBalance({ interactive, historyDays });
      assertCurrent();
      const result = await publication.publish(candidate, {
        financeRow, historyDays, lease, archiveReady, archiveVersion,
      });
      assertCurrent();
      device.recordScan(result.scan, assertConnection);
      onPublished(result);
      return true;
    } catch (error) {
      error = currentOperationError(error, () => {
        active();
        assertOwner?.();
        assertConnection?.()
      });
      onFailed(error, assertConnection, schedulerEpoch);
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
    return work.isActive() ? work.run(() => runRefresh(request)) : Promise.resolve(false);
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
    },
  };
  return { commands: { refresh }, runtime };
}
