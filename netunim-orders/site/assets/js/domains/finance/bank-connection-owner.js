// @ts-check
import { createRuntimeTaskOwner } from '../../shared/runtime-task-owner.js';
import { createBridgePairingScope } from '../../shared/bridge-pairing-scope.js';
export const ORDERS_BANK_BRIDGE_MINIMUM_VERSION = 74;

/** @typedef {Readonly<Record<string,unknown>>} BankConnectionStatus */
/** @typedef {()=>undefined} BankConnectionGuard */
/** @typedef {{ok:boolean,failure?:string}} BankConnectionResult */
/** @typedef {{status:BankConnectionStatus|null,checked:boolean,bridgeError:string}} BankConnectionReadout */
/** @typedef {{userCode?:string,password?:string,businessBranchNumber?:string,businessAccountNumber?:string,homeBranchNumber?:string,homeAccountNumber?:string}} BankCredentialInput */
/** @typedef {{role:'home'|'business',branchNumber:string,accountNumber:string}} BankAccountSelection */
/** @typedef {{readStatus:()=>Promise<unknown>,configure:(payload:Required<BankCredentialInput>)=>Promise<unknown>,selectAccount:(payload:BankAccountSelection)=>Promise<unknown>,deleteCredentials:()=>Promise<unknown>,readDiagnostics:()=>Promise<unknown>}} BankConnectionTransport */
/** @typedef {{commands:{configure:(payload:BankCredentialInput)=>Promise<BankConnectionResult>,selectAccount:(role:string,branch:string,account:string)=>Promise<BankConnectionResult>,deleteCredentials:()=>Promise<BankConnectionResult>,exportDiagnostics:()=>Promise<boolean>,recordScan:(details:BankConnectionStatus,guard:BankConnectionGuard)=>void,reportFailure:(error:unknown,guard:BankConnectionGuard)=>void},queries:{snapshot:()=>BankConnectionReadout,capture:()=>BankConnectionGuard,supported:(value:unknown)=>boolean,readStatus:()=>Promise<BankConnectionStatus>,refreshStatus:(options?:{quiet?:boolean})=>Promise<BankConnectionStatus|null>},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} OrdersBankConnectionAPI */

/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** @param {unknown} error */
function message(error) {
  return record(error) && error.message ? String(error.message) : String(error);
}
/** @param {string|undefined} value */
function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Owns device-scoped status, vault commands and diagnostic publication. Cloud
 * account/lease authority and financial busy policy remain with Finance.
 * @param {{pairing:{token:()=>string},transport:BankConnectionTransport,presentation:{toast:(message:string)=>void},effects:{saveJson:(name:unknown,data:unknown,fallback:string)=>undefined},protocol:{minimumBridgeVersion:number}}} ports
 * @returns {OrdersBankConnectionAPI}
 */
export function createOrdersBankConnectionOwner({
  pairing,
  transport,
  presentation,
  effects,
  protocol,
}) {
  if (!Number.isSafeInteger(protocol?.minimumBridgeVersion) || protocol.minimumBridgeVersion < 1)
    throw new TypeError('orders_bank_connection_protocol_required');
  for (const [name, port, methods] of /** @type {Array<[string,object,string[]]>} */ ([
    ['pairing', pairing, ['token']],
    [
      'transport',
      transport,
      ['readStatus', 'configure', 'selectAccount', 'deleteCredentials', 'readDiagnostics'],
    ],
    ['presentation', presentation, ['toast']],
    ['effects', effects, ['saveJson']],
  ]))
    for (const method of methods)
      if (typeof (/** @type {Record<string,unknown>} */ (port)?.[method]) !== 'function')
        throw new TypeError(`orders_bank_connection_${name}_${method}_required`);
  const work = createRuntimeTaskOwner(),
    scope = createBridgePairingScope({ readToken: () => pairing.token() });
  let generation = -1,
    revision = 0,
    writing = false;
  /** @type {BankConnectionReadout} */
  let readout = { status: null, checked: false, bridgeError: '' };
  function observe() {
    const live = scope.snapshot();
    if (live.generation !== generation) {
      generation = live.generation;
      revision++;
      readout = { status: null, checked: false, bridgeError: '' };
    }
    return live;
  }
  function capture() {
    observe();
    return scope.capture();
  }
  /** @param {BankConnectionGuard} guard */
  function current(guard) {
    observe();
    if (!work.isActive()) return false;
    try {
      guard();
      return true;
    } catch {
      return false;
    }
  }
  function snapshot() {
    if (work.isActive()) observe();
    return { ...readout };
  }
  /** @param {unknown} value */
  function supported(value) {
    return record(value) && Number(value.bridgeVersion || 0) >= protocol.minimumBridgeVersion;
  }
  async function readStatus() {
    const guard = capture(),
      serial = ++revision;
    readout = { ...readout, checked: true };
    try {
      const status = await transport.readStatus();
      guard();
      observe();
      if (!record(status)) throw new TypeError('orders_bank_connection_status_required');
      if (serial === revision)
        readout = {
          status,
          checked: true,
          bridgeError: supported(status)
            ? ''
            : 'Bank Bridge ישן. יש להריץ מחדש install_bank_bridge.bat במחשב זה.',
        };
      return status;
    } catch (error) {
      if (!current(guard)) {
        guard();
        throw new Error('orders_bank_connection_closed');
      }
      if (serial === revision)
        readout = { status: null, checked: true, bridgeError: message(error) };
      throw error;
    }
  }
  /** @param {{quiet?:boolean}} [options] */
  async function refreshStatus({ quiet = true } = {}) {
    if (!observe().paired) {
      readout = { status: null, checked: true, bridgeError: '' };
      return null;
    }
    const guard = capture(),
      serial = revision + 1;
    try {
      return await readStatus();
    } catch (error) {
      if (current(guard) && serial === revision && !quiet) presentation.toast(message(error));
      return null;
    }
  }
  /** @param {()=>Promise<unknown>} write @param {(result:unknown)=>BankConnectionStatus} project @param {string} success @returns {Promise<BankConnectionResult>} */
  async function writeCredentials(write, project, success) {
    if (writing) return { ok: false };
    let guard;
    try {
      guard = capture();
    } catch (error) {
      return { ok: false, failure: message(error) };
    }
    writing = true;
    revision++;
    try {
      const result = await write();
      if (!current(guard)) return { ok: false };
      revision++;
      readout = { ...readout, status: project(result) };
      presentation.toast(success);
      return { ok: true };
    } catch (error) {
      return current(guard) ? { ok: false, failure: message(error) } : { ok: false };
    } finally {
      writing = false;
    }
  }
  /** @param {BankCredentialInput} input */
  async function configure(input) {
    const payload = {
      userCode: String(input.userCode || '').trim(),
      password: String(input.password || ''),
      businessBranchNumber: digits(input.businessBranchNumber),
      businessAccountNumber: digits(input.businessAccountNumber),
      homeBranchNumber: digits(input.homeBranchNumber),
      homeAccountNumber: digits(input.homeAccountNumber),
    };
    return writeCredentials(
      () => transport.configure(payload),
      (result) => ({ ...readout.status, ...(record(result) ? result : {}), configured: true }),
      'פרטי בנק הפועלים נשמרו ב-Bank Bridge המקומי'
    );
  }
  /** @param {string} role @param {string} branch @param {string} account */
  async function selectAccount(role, branch, account) {
    const targetRole = role === 'home' ? 'home' : 'business';
    return writeCredentials(
      () =>
        transport.selectAccount({
          role: targetRole,
          branchNumber: digits(branch),
          accountNumber: digits(account),
        }),
      (result) => ({
        ...readout.status,
        ...(record(result) ? result : {}),
        configured: true,
        availableAccounts: [],
        accountRole: '',
      }),
      `נבחר החשבון ${targetRole === 'home' ? 'הביתי' : 'העסקי'}`
    );
  }
  async function deleteCredentials() {
    return writeCredentials(
      () => transport.deleteCredentials(),
      () => ({
        ...readout.status,
        configured: false,
        businessBranchNumber: '',
        businessAccountNumber: '',
        homeBranchNumber: '',
        homeAccountNumber: '',
        availableAccounts: [],
      }),
      'פרטי בנק הפועלים נמחקו מה-Bank Bridge המקומי'
    );
  }
  async function exportDiagnostics() {
    if (!observe().paired) {
      presentation.toast('יש לצמד את ניהול ההזמנות ל-Bank Bridge לפני ייצוא אבחון');
      return false;
    }
    const guard = capture();
    try {
      const value = await transport.readDiagnostics();
      if (!current(guard)) return false;
      const result = record(value) ? value : {};
      if (!result.available || !result.data)
        throw new Error(
          result.message
            ? String(result.message)
            : 'עדיין אין אבחון בנק מקומי. בצע רענון בנק ולאחריו נסה שוב.'
        );
      effects.saveJson(result.filename, result.data, 'netunim-bank-diagnostic.json');
      if (!current(guard)) return false;
      presentation.toast(
        `קובץ אבחון בנק JSON נוצר מהסנכרון האחרון (${Number(result.transactionCount) || 0} תנועות)`
      );
      return true;
    } catch (error) {
      if (current(guard)) presentation.toast(message(error));
      return false;
    }
  }
  /** @template T @param {()=>Promise<T>} command @param {T} inactive */
  function accepted(command, inactive) {
    return work.isActive() ? work.run(command) : Promise.resolve(inactive);
  }
  return {
    commands: {
      configure: (input) => accepted(() => configure(input), { ok: false }),
      selectAccount: (role, branch, account) =>
        accepted(() => selectAccount(role, branch, account), { ok: false }),
      deleteCredentials: () => accepted(deleteCredentials, { ok: false }),
      exportDiagnostics: () => accepted(exportDiagnostics, false),
      recordScan: (details, guard) => {
        if (!current(guard)) return;
        revision++;
        readout = { ...readout, status: { ...readout.status, ...details }, checked: true };
      },
      reportFailure: (error, guard) => {
        if (!current(guard) || !record(error)) return;
        revision++;
        if (['BRIDGE_UNAVAILABLE', 'BRIDGE_TIMEOUT'].includes(String(error.code)))
          readout = { ...readout, bridgeError: message(error) };
        if (Array.isArray(error.availableAccounts) && error.availableAccounts.length)
          readout = {
            ...readout,
            status: {
              ...readout.status,
              availableAccounts: error.availableAccounts,
              accountRole: error.accountRole || '',
            },
          };
      },
    },
    queries: {
      snapshot,
      capture,
      supported,
      readStatus: () =>
        work.isActive()
          ? work.run(readStatus)
          : Promise.reject(new Error('orders_bank_connection_closed')),
      refreshStatus: (options) => accepted(() => refreshStatus(options), null),
    },
    runtime: {
      isPending: work.isPending,
      drain: work.drain,
      dispose: () => {
        if (!work.close()) return false;
        scope.dispose();
        revision++;
        readout = { status: null, checked: false, bridgeError: '' };
        return true;
      },
    },
  };
}
