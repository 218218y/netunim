// @ts-check
import { createRuntimeTaskOwner } from '../../shared/runtime-task-owner.js';

/** @typedef {Record<string,unknown>} ConnectionRecord */
/** @typedef {{status:ConnectionRecord|null,checked:boolean,bridgeError:string}} ConnectionReadout */
/** @typedef {{ok:boolean,failure?:string}} ConnectionResult */
/** @typedef {()=>undefined} ConnectionGuard */
/** @typedef {{token:()=>string}} ConnectionPairing */
/** @typedef {{readStatus:()=>Promise<unknown>,readDiagnostics:()=>Promise<unknown>,readData:()=>Promise<unknown>,saveProfile:(payload:unknown)=>Promise<unknown>,deleteProfile:(id:string)=>Promise<unknown>,resetProfiles:()=>Promise<unknown>}} ConnectionTransport */
/** @typedef {{writeText:(text:string)=>Promise<void>,saveJson:(name:unknown,data:unknown,fallback:string)=>undefined}} ConnectionEffects */
/** @typedef {{commands:{copyDiagnostics:()=>Promise<boolean>,exportData:()=>Promise<boolean>,saveProfile:(payload:unknown)=>Promise<ConnectionResult>,deleteProfile:(id:string)=>Promise<ConnectionResult>,resetProfiles:()=>Promise<void>,reportFailure:(error:unknown)=>void},queries:{snapshot:()=>ConnectionReadout,capture:()=>ConnectionGuard,supported:(status:unknown)=>boolean,readStatus:()=>Promise<ConnectionRecord|null>,refreshStatus:(options?:{quiet?:boolean})=>Promise<ConnectionRecord|null>},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} OrdersCreditConnectionAPI */

/** @param {unknown} value @returns {value is ConnectionRecord} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** @param {unknown} error @param {string} [fallback] */
function message(error, fallback) {
  return record(error) && error.message ? String(error.message) : (fallback ?? String(error));
}
function scopeError() {
  return Object.assign(
    new Error('החיבור המקומי ל-Bank Bridge השתנה במהלך הפעולה. יש לבדוק את החיבור ולרענן שוב.'),
    { code: 'CREDIT_CONNECTION_SCOPE_CHANGED' }
  );
}

/**
 * Owns local pairing generations, connection readout and accepted local work.
 * Finance authority/leases and busy policy remain with their command owner.
 * No eager probe, browser resource or cloud publication is created here.
 * @param {{pairing:ConnectionPairing,transport:ConnectionTransport,presentation:{toast:(message:string)=>void},effects:ConnectionEffects,protocol:{minimumBridgeVersion:number,contractVersion:number}}} ports
 * @returns {OrdersCreditConnectionAPI}
 */
export function createOrdersCreditConnectionOwner({
  pairing,
  transport,
  presentation,
  effects,
  protocol,
}) {
  if (
    !Number.isSafeInteger(protocol?.minimumBridgeVersion) ||
    protocol.minimumBridgeVersion < 1 ||
    !Number.isSafeInteger(protocol?.contractVersion) ||
    protocol.contractVersion < 1
  )
    throw new TypeError('orders_credit_connection_protocol_required');
  for (const [name, port, methods] of /** @type {Array<[string,object,string[]]>} */ ([
    ['pairing', pairing, ['token']],
    [
      'transport',
      transport,
      [
        'readStatus',
        'readDiagnostics',
        'readData',
        'saveProfile',
        'deleteProfile',
        'resetProfiles',
      ],
    ],
    ['presentation', presentation, ['toast']],
    ['effects', effects, ['writeText', 'saveJson']],
  ]))
    for (const method of methods)
      if (typeof (/** @type {Record<string,unknown>} */ (port)?.[method]) !== 'function')
        throw new TypeError(`orders_credit_connection_${name}_${method}_required`);
  const work = createRuntimeTaskOwner();
  let observed = false,
    available = false,
    token = '',
    epoch = 0,
    revision = 0;
  /** @type {ConnectionReadout} */
  let readout = { status: null, checked: false, bridgeError: '' };
  function observe() {
    let live = '',
      readable = true;
    try {
      live = pairing.token();
    } catch {
      readable = false;
    }
    if (typeof live !== 'string') throw new TypeError('orders_credit_connection_token_required');
    if (!observed || live !== token || readable !== available) {
      observed = true;
      token = live;
      available = readable;
      epoch++;
      revision++;
      readout = { status: null, checked: false, bridgeError: '' };
    }
    return { token, epoch, available };
  }
  /** @param {{token:string,epoch:number,available:boolean}} permit */
  function current(permit) {
    if (!work.isActive()) return false;
    const live = observe();
    return (
      live.available &&
      permit.available &&
      live.token === permit.token &&
      live.epoch === permit.epoch
    );
  }
  /** @returns {ConnectionGuard} */
  function capture() {
    const permit = observe();
    return () => {
      if (!current(permit)) throw scopeError();
    };
  }
  function snapshot() {
    if (work.isActive()) observe();
    return { ...readout };
  }
  /** @param {unknown} value */
  function supported(value) {
    return (
      record(value) &&
      Number(value.bridgeVersion || 0) >= protocol.minimumBridgeVersion &&
      Number(value.contractVersion || 0) >= protocol.contractVersion
    );
  }
  /** @param {{token:string,epoch:number,available:boolean}} permit */
  async function readStatus(permit) {
    const serial = ++revision;
    readout = { ...readout, checked: true };
    if (!permit.available || !permit.token) {
      readout = { status: null, checked: true, bridgeError: '' };
      return null;
    }
    try {
      const status = await transport.readStatus();
      if (!current(permit)) throw scopeError();
      if (!record(status)) throw new TypeError('orders_credit_connection_status_required');
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
      if (!current(permit)) throw scopeError();
      if (serial === revision)
        readout = { status: null, checked: true, bridgeError: message(error) };
      throw error;
    }
  }
  /** @param {{quiet?:boolean}} [options] */
  async function refreshStatus({ quiet = true } = {}) {
    const permit = observe();
    try {
      return await readStatus(permit);
    } catch (error) {
      if (current(permit) && !quiet) presentation.toast(message(error));
      return null;
    }
  }
  async function copyDiagnostics() {
    const permit = observe();
    if (!permit.available) return false;
    try {
      const value = await transport.readDiagnostics();
      if (!current(permit)) return false;
      const result = record(value) ? value : {},
        events = Array.isArray(result.events) ? result.events : [];
      await effects.writeText(
        JSON.stringify(
          { contractVersion: result.contractVersion || protocol.contractVersion, events },
          null,
          2
        )
      );
      if (!current(permit)) return false;
      presentation.toast(`הועתק אבחון טכני בטוח (${events.length} אירועים מסוננים)`);
      return true;
    } catch (error) {
      if (current(permit)) presentation.toast(message(error, 'העתקת האבחון נכשלה'));
      return false;
    }
  }
  async function exportData() {
    const permit = observe();
    if (!permit.token) {
      presentation.toast('יש לצמד את ניהול ההזמנות ל-Bank Bridge לפני ייצוא אבחון אשראי');
      return false;
    }
    if (readout.status && !supported(readout.status)) {
      presentation.toast('יש להריץ מחדש install_bank_bridge.bat לפני ייצוא אבחון נתוני אשראי');
      return false;
    }
    try {
      const value = await transport.readData();
      if (!current(permit)) return false;
      const result = record(value) ? value : {};
      if (!result.available || !result.data)
        throw new Error(
          result.message
            ? String(result.message)
            : 'עדיין אין אבחון נתוני אשראי מקומי. בצע רענון אשראי ולאחריו נסה שוב.'
        );
      effects.saveJson(result.filename, result.data, 'netunim-credit-data-diagnostics.json');
      if (!current(permit)) return false;
      presentation.toast(
        `קובץ אבחון אשראי JSON נוצר מהסנכרון האחרון (${Number(result.cardCount) || 0} כרטיסים)`
      );
      return true;
    } catch (error) {
      if (current(permit)) presentation.toast(message(error, 'ייצוא אבחון האשראי נכשל'));
      return false;
    }
  }
  /** @param {()=>Promise<unknown>} write @param {string} success @returns {Promise<ConnectionResult>} */
  async function writeProfile(write, success) {
    const permit = observe();
    if (!permit.available) return { ok: false };
    try {
      await write();
      if (!current(permit)) return { ok: false };
      // Profile writes retain the historical soft status probe: a successful
      // vault write is still successful when its following status probe fails.
      await refreshStatus();
      if (!current(permit)) return { ok: false };
      presentation.toast(success);
      return { ok: true };
    } catch (error) {
      return current(permit) ? { ok: false, failure: message(error) } : { ok: false };
    }
  }
  async function resetProfiles() {
    const permit = observe(),
      status = readout.status;
    if (!permit.available) throw scopeError();
    revision++;
    await transport.resetProfiles();
    if (!current(permit)) throw scopeError();
    revision++;
    if (status) readout = { ...readout, status: { ...status, profiles: [], lastErrors: [] } };
  }
  /** @template T @param {()=>Promise<T>} run @param {T} inactive @returns {Promise<T>} */
  function accepted(run, inactive) {
    return work.isActive() ? work.run(run) : Promise.resolve(inactive);
  }
  return {
    commands: {
      reportFailure: /** @param {unknown} error */ (error) => {
        if (
          !work.isActive() ||
          !record(error) ||
          !['BRIDGE_UNAVAILABLE', 'BRIDGE_TIMEOUT'].includes(String(error.code))
        )
          return;
        observe();
        readout = { ...readout, bridgeError: message(error) };
      },
      copyDiagnostics: () => accepted(copyDiagnostics, false),
      exportData: () => accepted(exportData, false),
      saveProfile: /** @param {unknown} payload */ (payload) =>
        accepted(
          () => writeProfile(() => transport.saveProfile(payload), 'חיבור האשראי נשמר במחשב זה'),
          { ok: false }
        ),
      deleteProfile: /** @param {string} id */ (id) =>
        accepted(
          () => writeProfile(() => transport.deleteProfile(id), 'חיבור האשראי המקומי נמחק'),
          { ok: false }
        ),
      resetProfiles: () => accepted(resetProfiles, undefined),
    },
    queries: {
      snapshot,
      capture,
      supported,
      readStatus: () => accepted(() => readStatus(observe()), null),
      refreshStatus: /** @param {{quiet?:boolean}} [options] */ (options) =>
        accepted(() => refreshStatus(options), null),
    },
    runtime: {
      isPending: work.isPending,
      drain: work.drain,
      dispose: () => {
        if (!work.close()) return false;
        epoch++;
        revision++;
        return true;
      },
    },
  };
}
