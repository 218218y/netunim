// @ts-check
/** @typedef {Record<string,unknown>} ConnectionRecord */
/** @typedef {{status:ConnectionRecord|null,bridgeError:string,bridgeErrorAt:string|null}} ConnectionReadout */
/** @typedef {{token:string,epoch:number}} ConnectionPermit */
/** @typedef {{token:()=>string}} ConnectionPairing */
/** @typedef {{readStatus:()=>Promise<unknown>,readDiagnostics:()=>Promise<unknown>,readData:()=>Promise<unknown>,saveProfile:(payload:unknown)=>Promise<unknown>,deleteProfile:(profileId:string)=>Promise<unknown>}} ConnectionTransport */
/** @typedef {{toast:(message:string)=>void,render:()=>void,confirmDialog:(title:string,body:string,options:{confirmText:string})=>Promise<boolean>}} ConnectionPresentation */
/** @typedef {{writeText:(text:string)=>Promise<void>,saveJson:(filename:unknown,data:unknown,fallback:string)=>undefined}} ConnectionEffects */
/** @typedef {()=>undefined} ConnectionGuard */
/** @typedef {{commands:{copyDiagnostics:()=>Promise<boolean>,exportData:()=>Promise<boolean>,saveConnection:(payload:unknown)=>Promise<boolean>,deleteConnection:(profileId:string)=>Promise<boolean|undefined>},queries:{snapshot:()=>ConnectionReadout,supported:(value:unknown)=>boolean,connectionProfile:(profileId:string)=>(ConnectionRecord&{local:boolean})|null,capture:()=>ConnectionGuard,tokenConfigured:()=>boolean,refreshStatus:(options?:{quiet?:boolean})=>Promise<ConnectionRecord|null>},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} CreditConnectionAPI */

/** @param {unknown} value @returns {value is ConnectionRecord} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** @param {unknown} error @returns {string} */
function message(error) {
  return record(error) && error.message ? String(error.message) : String(error);
}
/** @param {unknown} error @param {string} fallback */
function errorMessage(error, fallback) {
  return record(error) && error.message ? String(error.message) : fallback;
}

/**
 * Local Bridge identity and profile/diagnostic resources have one owner. They
 * do not confer authenticated Finance authority, provider leases or cloud ACKs.
 * Construction is inert; accepted operations remain drainable after disposal.
 * @param {{pairing:ConnectionPairing,transport:ConnectionTransport,presentation:ConnectionPresentation,effects:ConnectionEffects,profiles:{read:()=>ConnectionRecord[]},protocol:{minimumBridgeVersion:number,contractVersion:number}}} ports
 * @returns {CreditConnectionAPI}
 */
export function createCreditConnectionOwner({
  pairing,
  transport,
  presentation,
  effects,
  profiles,
  protocol,
}) {
  if (
    !Number.isSafeInteger(protocol?.minimumBridgeVersion) ||
    protocol.minimumBridgeVersion < 1 ||
    !Number.isSafeInteger(protocol?.contractVersion) ||
    protocol.contractVersion < 1
  )
    throw new TypeError('credit_connection_protocol_required');
  for (const [name, port, methods] of /** @type {Array<[string,object,string[]]>} */ ([
    ['pairing', pairing, ['token']],
    [
      'transport',
      transport,
      ['readStatus', 'readDiagnostics', 'readData', 'saveProfile', 'deleteProfile'],
    ],
    ['presentation', presentation, ['toast', 'render', 'confirmDialog']],
    ['effects', effects, ['writeText', 'saveJson']],
    ['profiles', profiles, ['read']],
  ])) {
    for (const method of methods)
      if (typeof (/** @type {Record<string,unknown>} */ (port)?.[method]) !== 'function')
        throw new TypeError(`credit_connection_${name}_${method}_required`);
  }
  let disposed = false,
    observed = false,
    token = '',
    epoch = 0,
    readRevision = 0;
  /** @type {ConnectionReadout} */
  let readout = { status: null, bridgeError: '', bridgeErrorAt: null };
  /** @type {Set<Promise<unknown>>} */
  const accepted = new Set();

  function observe() {
    const live = pairing.token();
    if (typeof live !== 'string') throw new TypeError('credit_connection_pairing_token_required');
    if (!observed || live !== token) {
      observed = true;
      token = live;
      epoch++;
      readRevision++;
      readout = { status: null, bridgeError: '', bridgeErrorAt: null };
    }
    return { token, epoch };
  }
  /** @param {ConnectionPermit} permit */
  function current(permit) {
    if (disposed) return false;
    const live = observe();
    return live.epoch === permit.epoch && live.token === permit.token;
  }
  function snapshot() {
    if (!disposed) observe();
    return { ...readout };
  }
  /** @returns {ConnectionGuard} */
  function capture() {
    const permit = observe();
    return () => {
      if (!current(permit))
        throw Object.assign(
          new Error(
            'החיבור המקומי ל-Bank Bridge השתנה במהלך הפעולה. הנתונים הקודמים נשמרו; יש לבדוק את החיבור ולרענן שוב.'
          ),
          { code: 'CREDIT_CONNECTION_SCOPE_CHANGED' }
        );
    };
  }
  /** @param {unknown} value */
  function supported(value) {
    return (
      record(value) &&
      Number(value.bridgeVersion || 0) >= protocol.minimumBridgeVersion &&
      Number(value.contractVersion || 0) >= protocol.contractVersion
    );
  }

  /** @param {{quiet?:boolean}} [options] @returns {Promise<ConnectionRecord|null>} */
  async function readStatus({ quiet = true } = {}) {
    const permit = observe(),
      revision = ++readRevision;
    try {
      const value = await transport.readStatus();
      if (!current(permit) || revision !== readRevision) return null;
      if (!record(value)) throw new TypeError('credit_connection_status_required');
      readout = {
        status: value,
        bridgeError: supported(value)
          ? ''
          : 'Bank Bridge ישן. יש להריץ שוב install_bank_bridge.bat במחשב זה.',
        bridgeErrorAt: supported(value) ? null : new Date().toISOString(),
      };
      if (!quiet) presentation.render();
      return value;
    } catch (error) {
      if (!current(permit) || revision !== readRevision) return null;
      readout = {
        status: null,
        bridgeError: message(error),
        bridgeErrorAt: new Date().toISOString(),
      };
      if (!quiet) presentation.render();
      return null;
    }
  }
  async function copyDiagnostics() {
    const permit = observe();
    try {
      const value = await transport.readDiagnostics();
      if (!current(permit)) return false;
      const result = record(value) ? value : {},
        events = Array.isArray(result.events) ? result.events : [];
      const content = JSON.stringify(
        { contractVersion: result.contractVersion || protocol.contractVersion, events },
        null,
        2
      );
      await effects.writeText(content);
      if (!current(permit)) return false;
      presentation.toast(`הועתק אבחון טכני בטוח (${events.length} אירועים מסוננים)`);
      return true;
    } catch (error) {
      if (current(permit)) presentation.toast(errorMessage(error, 'העתקת האבחון נכשלה'));
      return false;
    }
  }
  async function exportData() {
    const permit = observe();
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
      if (current(permit)) presentation.toast(errorMessage(error, 'ייצוא אבחון האשראי נכשל'));
      return false;
    }
  }
  /** @param {unknown} payload */
  async function saveConnection(payload) {
    const permit = observe();
    try {
      await transport.saveProfile(payload);
      if (!current(permit)) return false;
      await readStatus();
      if (!current(permit)) return false;
      presentation.toast('חיבור האשראי נשמר במחשב');
      presentation.render();
      return true;
    } catch (error) {
      if (current(permit)) presentation.toast(errorMessage(error, 'שמירת חיבור האשראי נכשלה'));
      return false;
    }
  }
  /** @param {string} profileId */
  async function deleteConnection(profileId) {
    const permit = observe();
    if (
      !(await presentation.confirmDialog(
        'למחוק חיבור מהמחשב?',
        'פרטי ההתחברות המוצפנים של החיבור יימחקו מהמחשב הזה. נתוני הסנכרון שכבר נשמרו בקופה/בענן לא יימחקו ולכן החיבור עדיין עשוי להופיע כ״הוגדר גם במחשב זה״. למחיקה מלאה והתחלה מחדש השתמש ב״איפוס מלא״.',
        { confirmText: 'מחק חיבור' }
      ))
    )
      return;
    if (!current(permit)) return false;
    try {
      await transport.deleteProfile(profileId);
      if (!current(permit)) return false;
      await readStatus();
      if (!current(permit)) return false;
      presentation.toast('החיבור המקומי נמחק');
      presentation.render();
    } catch (error) {
      if (current(permit)) presentation.toast(errorMessage(error, 'מחיקת החיבור נכשלה'));
    }
  }
  /** @param {string} profileId */
  function connectionProfile(profileId) {
    const state = snapshot(),
      locals = Array.isArray(state.status?.profiles) ? state.status.profiles : [];
    const local = locals.find((profile) => record(profile) && profile.profileId === profileId);
    const profile = record(local)
      ? local
      : profiles.read().find((profile) => profile.profileId === profileId);
    return profile ? { ...profile, local: record(local) } : null;
  }
  /** @template T @param {()=>Promise<T>} run @param {T} inactive @returns {Promise<T>} */
  function tracked(run, inactive) {
    if (disposed) return Promise.resolve(inactive);
    // Capture identity and enter the port at command acceptance, before another
    // microtask can replace the pairing. Retain both success and failure work.
    /** @type {Promise<T>} */
    let result;
    try {
      result = run();
    } catch (error) {
      result = Promise.reject(error);
    }
    accepted.add(result);
    void result.then(
      () => accepted.delete(result),
      () => accepted.delete(result)
    );
    return result;
  }
  const runtime = {
    isPending: () => accepted.size > 0,
    async drain() {
      while (accepted.size) await Promise.allSettled([...accepted]);
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      epoch++;
      readRevision++;
      return true;
    },
  };
  return {
    commands: {
      copyDiagnostics: () => tracked(copyDiagnostics, false),
      exportData: () => tracked(exportData, false),
      saveConnection: /** @param {unknown} payload */ (payload) =>
        tracked(() => saveConnection(payload), false),
      deleteConnection: /** @param {string} profileId */ (profileId) =>
        tracked(() => deleteConnection(profileId), false),
    },
    queries: {
      snapshot,
      supported,
      connectionProfile,
      capture,
      tokenConfigured: () => !disposed && !!observe().token,
      refreshStatus: /** @param {{quiet?:boolean}} [options] */ (options) =>
        tracked(() => readStatus(options), null),
    },
    runtime,
  };
}
