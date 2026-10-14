// @ts-check
import { createRuntimeTaskOwner } from '../../shared/runtime-task-owner.js';
import { createBridgePairingScope } from '../../shared/bridge-pairing-scope.js';

export const KUPA_BANK_BRIDGE_MINIMUM_VERSION = 74;
/** @typedef {Readonly<Record<string,unknown>>} ConnectionRecord */
/** @typedef {()=>undefined} ConnectionGuard */
/** @typedef {{token?:string,userCode?:string,password?:string,businessBranchNumber?:string,businessAccountNumber?:string,homeBranchNumber?:string,homeAccountNumber?:string}} CredentialInput */
/** @typedef {Required<CredentialInput>} CredentialPayload */
/** @typedef {{role:'business'|'home',branchNumber:string,accountNumber:string}} AccountSelection */
/** @typedef {{readStatus:()=>Promise<unknown>,configure:(input:CredentialPayload)=>Promise<unknown>,selectAccount:(input:AccountSelection)=>Promise<unknown>,deleteCredentials:()=>Promise<unknown>,readDiagnostics:()=>Promise<unknown>}} ConnectionTransport */
/** @typedef {{checked:boolean,available:boolean|null,configured:boolean,busy:boolean,upgradeRequired:boolean,bridgeVersion:number,branchNumber:string,accountNumber:string,businessBranchNumber:string,businessAccountNumber:string,homeBranchNumber:string,homeAccountNumber:string,availableAccounts:unknown[],accountSelectionRole:string,lastScrapeAt:string|null,lastError:string,lastErrorAt:string|null,lastErrorCode:string,lastErrorStage:string,lastErrorHttpStatus:number,lastWarning:string,lastWarningCode:string,lastWarningStage:string,lastWarningHttpStatus:number,availabilityError:string,availabilityErrorAt:string|null,message:string}} ConnectionState */
/** @typedef {ConnectionState & {tokenConfigured:boolean,generation:number,commandRevision:number}} ConnectionReadout */
/** @typedef {{commands:{saveToken:(value:string)=>Promise<boolean>,configure:(input?:CredentialInput)=>Promise<boolean>,selectAccount:(role:string,branch:string,account:string)=>Promise<boolean>,deleteCredentials:()=>Promise<boolean>,exportDiagnostics:()=>Promise<boolean>,recordScan:(details:ConnectionRecord,guard:ConnectionGuard)=>void},queries:{snapshot:()=>ConnectionReadout,capture:()=>ConnectionGuard,isCurrent:(guard:ConnectionGuard)=>boolean,readStatus:()=>Promise<ConnectionRecord>,refreshStatus:(options?:{force?:boolean})=>Promise<ConnectionReadout>,supported:(value:unknown)=>boolean},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} KupaBankConnectionAPI */

/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** @param {unknown} error */
function message(error) {
  return record(error) && error.message ? String(error.message) : String(error);
}
/** @param {unknown} value */
function text(value) {
  return String(value || '');
}
function initialState() {
  return /** @type {ConnectionState} */ ({
    checked: false,
    available: null,
    configured: false,
    busy: false,
    upgradeRequired: false,
    bridgeVersion: 0,
    branchNumber: '',
    accountNumber: '',
    businessBranchNumber: '',
    businessAccountNumber: '',
    homeBranchNumber: '',
    homeAccountNumber: '',
    availableAccounts: [],
    accountSelectionRole: '',
    lastScrapeAt: null,
    lastError: '',
    lastErrorAt: null,
    lastErrorCode: '',
    lastErrorStage: '',
    lastErrorHttpStatus: 0,
    lastWarning: '',
    lastWarningCode: '',
    lastWarningStage: '',
    lastWarningHttpStatus: 0,
    availabilityError: '',
    availabilityErrorAt: null,
    message: '',
  });
}
/** @param {ConnectionState} target @param {ConnectionRecord} source */
function applyBridgeAccountFields(target, source = {}) {
  const businessBranchNumber =
    source.businessBranchNumber ||
    source.branchNumber ||
    target.businessBranchNumber ||
    target.branchNumber ||
    '';
  const businessAccountNumber =
    source.businessAccountNumber ||
    source.accountNumber ||
    target.businessAccountNumber ||
    target.accountNumber ||
    '';
  Object.assign(target, {
    branchNumber: businessBranchNumber,
    accountNumber: businessAccountNumber,
    businessBranchNumber,
    businessAccountNumber,
    homeBranchNumber: source.homeBranchNumber ?? target.homeBranchNumber ?? '',
    homeAccountNumber: source.homeAccountNumber ?? target.homeAccountNumber ?? '',
  });
}
/**
 * Owns local device evidence and accepted Bridge requests. Financial leases and
 * durable publication belong to the Bank controller, independently of pairing.
 * @param {{pairing:{read:()=>string,write:(value:string)=>void},transport:ConnectionTransport,presentation:{changed:()=>void,toast:(message:string)=>void},effects:{saveJson:(name:unknown,data:unknown,fallback:string)=>undefined},clock:{now:()=>number},protocol:{minimumBridgeVersion:number,statusCacheMs:number}}} ports
 * @returns {KupaBankConnectionAPI}
 */
export function createKupaBankConnectionOwner({
  pairing,
  transport,
  presentation,
  effects,
  clock,
  protocol,
}) {
  if (
    !Number.isSafeInteger(protocol?.minimumBridgeVersion) ||
    protocol.minimumBridgeVersion < 1 ||
    !Number.isFinite(protocol.statusCacheMs) ||
    protocol.statusCacheMs < 0
  )
    throw new TypeError('kupa_bank_connection_protocol_required');
  for (const [name, port, methods] of /** @type {Array<[string,object,string[]]>} */ ([
    ['pairing', pairing, ['read', 'write']],
    [
      'transport',
      transport,
      ['readStatus', 'configure', 'selectAccount', 'deleteCredentials', 'readDiagnostics'],
    ],
    ['presentation', presentation, ['changed', 'toast']],
    ['effects', effects, ['saveJson']],
    ['clock', clock, ['now']],
  ]))
    for (const method of methods)
      if (typeof (/** @type {Record<string,unknown>} */ (port)?.[method]) !== 'function')
        throw new TypeError(`kupa_bank_connection_${name}_${method}_required`);
  const work = createRuntimeTaskOwner(),
    scope = createBridgePairingScope({ readToken: pairing.read });
  let state = initialState(),
    generation = -1,
    revision = 0,
    commandRevision = 0,
    writing = false;
  /** @type {number|null} */ let checkedAt = null;
  /** @type {{generation:number,revision:number,promise:Promise<ConnectionReadout>}|null} */ let flight =
    null;
  function observe() {
    const live = scope.snapshot();
    if (live.generation !== generation) {
      generation = live.generation;
      revision++;
      state = initialState();
      checkedAt = null;
    }
    return live;
  }
  function snapshot() {
    const live = observe();
    return {
      ...state,
      busy: writing,
      availableAccounts: [...state.availableAccounts],
      tokenConfigured: live.paired,
      generation: live.generation,
      commandRevision,
    };
  }
  function capture() {
    observe();
    return scope.capture();
  }
  /** @param {ConnectionGuard} guard */
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
  function changed() {
    if (work.isActive()) presentation.changed();
  }
  /** @param {unknown} value */
  function supported(value) {
    return (
      record(value) &&
      Number.isSafeInteger(Number(value.bridgeVersion)) &&
      Number(value.bridgeVersion) >= protocol.minimumBridgeVersion
    );
  }
  /** @param {ConnectionRecord} value */
  function publishStatus(value) {
    Object.assign(state, {
      checked: true,
      available: true,
      configured: !!value.configured,
      bridgeVersion: Number(value.bridgeVersion) || 0,
      upgradeRequired: !supported(value),
      availableAccounts: Array.isArray(value.availableAccounts) ? value.availableAccounts : [],
      accountSelectionRole: text(value.accountRole),
      lastScrapeAt: value.lastScrapeAt ? String(value.lastScrapeAt) : null,
      lastError: text(value.lastError),
      lastErrorAt: value.lastErrorAt ? String(value.lastErrorAt) : null,
      lastErrorCode: text(value.lastErrorCode),
      lastErrorStage: text(value.lastErrorStage),
      lastErrorHttpStatus: Number(value.lastErrorHttpStatus) || 0,
      lastWarning: text(value.lastWarning),
      lastWarningCode: text(value.lastWarningCode),
      lastWarningStage: text(value.lastWarningStage),
      lastWarningHttpStatus: Number(value.lastWarningHttpStatus) || 0,
      availabilityError: '',
      availabilityErrorAt: null,
    });
    applyBridgeAccountFields(state, value);
    state.message = state.upgradeRequired
      ? 'מותקנת במחשב גרסת Bank Bridge ישנה. יש להריץ מחדש install_bank_bridge.bat כדי להפעיל סנכרון בטוח של החשבון העסקי והביתי יחד.'
      : value.configured
        ? 'החיבור המקומי מוכן.'
        : 'Bank Bridge פעיל, אך עדיין לא נשמרו בו פרטי בנק הפועלים.';
  }
  async function readStatus() {
    const guard = capture();
    guard();
    const value = await transport.readStatus();
    guard();
    if (!record(value)) throw new TypeError('bank_connection_status_invalid');
    return value;
  }
  /** @param {{force?:boolean}} options */
  function refreshStatus({ force = true } = {}) {
    if (!work.isActive()) return Promise.resolve(snapshot());
    const live = observe(),
      now = clock.now();
    if (!live.paired) {
      state.message = 'יש להזין מפתח Bridge כדי לחבר את הקופה לתוכנה המקומית.';
      state.checked = true;
      return Promise.resolve(snapshot());
    }
    if (flight?.generation === generation && flight.revision === revision) return flight.promise;
    if (
      !force &&
      checkedAt !== null &&
      now >= checkedAt &&
      now - checkedAt < protocol.statusCacheMs
    )
      return Promise.resolve(snapshot());
    const guard = capture(),
      acceptedRevision = revision;
    const promise = work.run(async () => {
      try {
        const value = await readStatus();
        if (current(guard) && revision === acceptedRevision && !writing) {
          publishStatus(value);
          checkedAt = clock.now();
          changed();
        }
      } catch (error) {
        if (current(guard) && revision === acceptedRevision && !writing) {
          const failure = message(error);
          Object.assign(state, {
            checked: true,
            available: false,
            availableAccounts:
              record(error) && Array.isArray(error.availableAccounts)
                ? error.availableAccounts
                : [],
            accountSelectionRole: record(error) ? text(error.accountRole) : '',
            availabilityError: failure,
            availabilityErrorAt: new Date(clock.now()).toISOString(),
            message: failure,
          });
          checkedAt = clock.now();
          changed();
        }
      }
      return snapshot();
    });
    const accepted = { generation, revision, promise };
    flight = accepted;
    void promise.then(
      () => {
        if (flight === accepted) flight = null;
      },
      () => {
        if (flight === accepted) flight = null;
      }
    );
    return promise;
  }
  function clearErrors() {
    Object.assign(state, {
      availableAccounts: [],
      accountSelectionRole: '',
      lastError: '',
      lastErrorAt: null,
      lastErrorCode: '',
      lastErrorStage: '',
      lastErrorHttpStatus: 0,
      lastWarning: '',
      lastWarningCode: '',
      lastWarningStage: '',
      lastWarningHttpStatus: 0,
      availabilityError: '',
      availabilityErrorAt: null,
    });
  }
  /** @param {unknown} error @param {string} role */
  function reportFailure(error, role) {
    Object.assign(state, {
      lastError: message(error),
      lastErrorAt: new Date(clock.now()).toISOString(),
      lastErrorCode: record(error) ? text(error.code) : '',
      lastErrorStage: record(error) ? text(error.stage) : '',
      lastErrorHttpStatus: record(error) ? Number(error.httpStatus) || 0 : 0,
      availableAccounts:
        record(error) && Array.isArray(error.availableAccounts)
          ? error.availableAccounts
          : role
            ? state.availableAccounts
            : [],
      accountSelectionRole: record(error) && error.accountRole ? text(error.accountRole) : role,
    });
    presentation.toast(state.lastError);
  }
  /** @param {()=>Promise<unknown>} operation @param {(value:ConnectionRecord)=>void} publish @param {string} role */
  function write(operation, publish, role = '') {
    if (!work.isActive() || writing || !observe().paired) return Promise.resolve(false);
    let guard;
    try {
      guard = capture();
    } catch {
      return Promise.resolve(false);
    }
    writing = true;
    commandRevision++;
    revision++;
    checkedAt = null;
    return work.run(async () => {
      try {
        guard();
        changed();
        guard();
        const value = await operation();
        if (!current(guard)) return false;
        clearErrors();
        publish(record(value) ? value : {});
        return true;
      } catch (error) {
        if (current(guard)) reportFailure(error, role);
        return false;
      } finally {
        writing = false;
        revision++;
        checkedAt = null;
        if (current(guard)) changed();
      }
    });
  }
  /** @param {string} value */
  function saveToken(value) {
    if (!work.isActive() || writing) return Promise.resolve(false);
    const token = text(value).trim();
    if (!token) {
      presentation.toast('יש להדביק את מפתח ה-Bridge של המחשב הנוכחי');
      return Promise.resolve(false);
    }
    let guard;
    try {
      pairing.write(token);
      observe();
      guard = capture();
    } catch {
      presentation.toast('לא ניתן לשמור את מפתח ה-Bridge בדפדפן זה');
      return Promise.resolve(false);
    }
    state.message = 'מפתח המחשב נשמר בדפדפן זה. בודק את ה-Bridge…';
    commandRevision++;
    checkedAt = null;
    return work.run(async () => {
      if (!current(guard)) return false;
      changed();
      if (!current(guard)) return false;
      await refreshStatus();
      if (!current(guard)) return false;
      if (state.available) presentation.toast('מפתח ה-Bridge נשמר והמחשב מחובר');
      return !!state.available;
    });
  }
  /** @param {CredentialInput} input */
  function configure(input = {}) {
    if (!work.isActive() || writing) return Promise.resolve(false);
    const userCode = text(input.userCode).trim(),
      password = text(input.password),
      businessBranchNumber = text(input.businessBranchNumber).trim(),
      businessAccountNumber = text(input.businessAccountNumber).trim(),
      homeBranchNumber = text(input.homeBranchNumber).trim(),
      homeAccountNumber = text(input.homeAccountNumber).trim();
    if (!userCode || !password) {
      presentation.toast('יש להזין קוד משתמש וסיסמה של בנק הפועלים');
      return Promise.resolve(false);
    }
    if (!!businessBranchNumber !== !!businessAccountNumber) {
      presentation.toast('לחשבון העסקי יש להזין גם סניף וגם מספר חשבון');
      return Promise.resolve(false);
    }
    if (!!homeBranchNumber !== !!homeAccountNumber) {
      presentation.toast('לחשבון הביתי יש להזין גם סניף וגם מספר חשבון');
      return Promise.resolve(false);
    }
    if (
      businessBranchNumber &&
      homeBranchNumber &&
      businessBranchNumber.replace(/\D/g, '') === homeBranchNumber.replace(/\D/g, '') &&
      businessAccountNumber.replace(/\D/g, '') === homeAccountNumber.replace(/\D/g, '')
    ) {
      presentation.toast('החשבון העסקי והחשבון הביתי חייבים להיות שני חשבונות שונים');
      return Promise.resolve(false);
    }
    const typedToken = text(input.token).trim();
    try {
      if (typedToken) {
        pairing.write(typedToken);
        observe();
      }
    } catch {
      presentation.toast('לא ניתן לשמור את מפתח ה-Bridge בדפדפן זה');
      return Promise.resolve(false);
    }
    if (!observe().paired) {
      presentation.toast('יש לשמור קודם את מפתח ה-Bridge של המחשב הנוכחי');
      return Promise.resolve(false);
    }
    let token;
    try {
      token = pairing.read();
    } catch {
      observe();
      return Promise.resolve(false);
    }
    return write(
      () =>
        transport.configure({
          token,
          userCode,
          password,
          businessBranchNumber,
          businessAccountNumber,
          homeBranchNumber,
          homeAccountNumber,
        }),
      (value) => {
        state.available = true;
        state.configured = true;
        state.message = 'פרטי ההתחברות ושני החשבונות נשמרו מוצפנים במחשב המקומי.';
        applyBridgeAccountFields(state, value);
        presentation.toast(
          homeAccountNumber
            ? 'החיבור לבנק הפועלים נשמר. רענון יעדכן יחד את החשבון העסקי והביתי.'
            : 'החיבור לבנק הפועלים נשמר. אפשר להוסיף גם את החשבון הביתי בהגדרות.'
        );
      }
    );
  }
  /** @param {string} role @param {string} branchNumber @param {string} accountNumber */
  function selectAccount(role, branchNumber, accountNumber) {
    const targetRole = role === 'home' ? 'home' : 'business',
      branch = text(branchNumber).replace(/\D/g, ''),
      account = text(accountNumber).replace(/\D/g, '');
    if (!work.isActive() || writing) return Promise.resolve(false);
    if (!branch || !account) {
      presentation.toast('לא התקבל סניף/חשבון תקין לבחירה');
      return Promise.resolve(false);
    }
    return write(
      () =>
        transport.selectAccount({ role: targetRole, branchNumber: branch, accountNumber: account }),
      (value) => {
        state.configured = true;
        applyBridgeAccountFields(state, value);
        state.message = `נבחר חשבון ${targetRole === 'home' ? 'ביתי' : 'עסקי'}: סניף ${branch}, חשבון ${account}. אפשר לרענן כעת.`;
        presentation.toast(
          `נבחר חשבון ${targetRole === 'home' ? 'ביתי' : 'עסקי'} ${branch}-${account}`
        );
      },
      targetRole
    );
  }
  function deleteCredentials() {
    return write(
      () => transport.deleteCredentials(),
      () => {
        Object.assign(state, {
          configured: false,
          branchNumber: '',
          accountNumber: '',
          businessBranchNumber: '',
          businessAccountNumber: '',
          homeBranchNumber: '',
          homeAccountNumber: '',
          message: 'פרטי ההתחברות נמחקו מהמחשב המקומי.',
        });
        presentation.toast('פרטי בנק הפועלים נמחקו מה-Bank Bridge');
      }
    );
  }
  function exportDiagnostics() {
    if (!work.isActive() || writing) return Promise.resolve(false);
    if (!observe().paired) {
      presentation.toast('יש לצמד את הקופה ל-Bank Bridge לפני ייצוא אבחון');
      return Promise.resolve(false);
    }
    const guard = capture();
    return work.run(async () => {
      try {
        const result = await transport.readDiagnostics();
        if (!current(guard)) return false;
        if (!record(result) || !result.available || !result.data)
          throw new Error(
            record(result) && result.message
              ? String(result.message)
              : 'עדיין אין אבחון בנק מקומי. בצע רענון בנק ולאחריו נסה שוב.'
          );
        effects.saveJson(result.filename, result.data, 'netunim-bank-diagnostic.json');
        if (current(guard))
          presentation.toast(
            `קובץ אבחון בנק JSON נוצר מהסנכרון האחרון (${Number(result.transactionCount) || 0} תנועות)`
          );
        return true;
      } catch (error) {
        if (current(guard)) presentation.toast(message(error));
        return false;
      }
    });
  }
  /** @param {ConnectionRecord} details @param {ConnectionGuard} guard */
  function recordScan(details, guard) {
    guard();
    observe();
    Object.assign(state, {
      available: true,
      configured: true,
      bridgeVersion: Number(details.bridgeVersion) || 0,
      upgradeRequired: !supported(details),
      lastScrapeAt: details.lastScrapeAt ? String(details.lastScrapeAt) : null,
      availableAccounts: Array.isArray(details.availableAccounts) ? details.availableAccounts : [],
      accountSelectionRole: text(details.accountSelectionRole),
    });
    applyBridgeAccountFields(state, details);
  }
  return {
    commands: {
      saveToken,
      configure,
      selectAccount,
      deleteCredentials,
      exportDiagnostics,
      recordScan,
    },
    queries: {
      snapshot,
      capture,
      isCurrent: current,
      readStatus: () =>
        work.run(async () => {
          const guard = capture(),
            acceptedRevision = revision;
          const value = await readStatus();
          guard();
          if (current(guard) && revision === acceptedRevision && !writing) {
            publishStatus(value);
            checkedAt = clock.now();
          }
          return value;
        }),
      refreshStatus,
      supported,
    },
    runtime: {
      isPending: work.isPending,
      drain: work.drain,
      dispose() {
        if (!work.close()) return false;
        scope.dispose();
        return true;
      },
    },
  };
}
