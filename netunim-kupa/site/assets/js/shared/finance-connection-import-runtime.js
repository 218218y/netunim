// @ts-check
import { createRuntimeTaskOwner } from './runtime-task-owner.js';
import { createBridgePairingScope } from './bridge-pairing-scope.js';
export const FINANCE_CONNECTION_IMPORT_MINIMUM_VERSION = 66;
/** @typedef {()=>undefined} ImportGuard */
/** @typedef {{payload:unknown,summary:{bankAccountCount:number,creditProfileCount:number}}} PreparedConnectionImport */
/** @typedef {{choose:()=>Promise<unknown|null>,runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} ConnectionFileSelection */
/** @typedef {{commands:{importConnections:()=>Promise<boolean>},runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} FinanceConnectionImportRuntime */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** @param {unknown} error */
function message(error) {
  return record(error) && error.message ? String(error.message) : 'ייבוא הגדרות החיבור נכשל';
}
/**
 * A single accepted import owns pairing from status through selection,
 * confirmation, local vault replacement and publication. It grants no cloud
 * write or financial lease authority.
 * @param {{pairing:{token:()=>string},transport:{status:()=>Promise<unknown>,replace:(payload:unknown)=>Promise<unknown>},selection:ConnectionFileSelection,document:{prepare:(selected:unknown)=>PreparedConnectionImport},presentation:{confirm:(title:string,message:string,options:{confirmText:string})=>Promise<boolean>,toast:(message:string)=>void,publish:(result:unknown,guard:ImportGuard)=>Promise<void>},protocol:{minimumBridgeVersion:number}}} ports
 * @returns {FinanceConnectionImportRuntime}
 */
export function createFinanceConnectionImportRuntime({
  pairing,
  transport,
  selection,
  document,
  presentation,
  protocol,
}) {
  if (!Number.isSafeInteger(protocol?.minimumBridgeVersion) || protocol.minimumBridgeVersion < 1)
    throw new TypeError('finance_connection_import_protocol_required');
  for (const [name, port, methods] of /** @type {Array<[string,object,string[]]>} */ ([
    ['pairing', pairing, ['token']],
    ['transport', transport, ['status', 'replace']],
    ['selection', selection, ['choose']],
    ['selection_runtime', selection?.runtime, ['isPending', 'drain', 'dispose']],
    ['document', document, ['prepare']],
    ['presentation', presentation, ['confirm', 'toast', 'publish']],
  ]))
    for (const method of methods)
      if (typeof (/** @type {Record<string,unknown>} */ (port)?.[method]) !== 'function')
        throw new TypeError(`finance_connection_import_${name}_${method}_required`);
  const work = createRuntimeTaskOwner(),
    scope = createBridgePairingScope({ readToken: () => pairing.token() });
  let importing = false;
  /** @param {ImportGuard} guard */
  function current(guard) {
    if (!work.isActive()) return false;
    try {
      guard();
      return true;
    } catch {
      return false;
    }
  }
  function importConnections() {
    if (!work.isActive() || importing) return Promise.resolve(false);
    if (!scope.snapshot().paired) {
      presentation.toast('יש לצמד קודם את המחשב ל-Bank Bridge');
      return Promise.resolve(false);
    }
    /** @type {ImportGuard} */ let guard;
    try {
      guard = scope.capture();
    } catch {
      return Promise.resolve(false);
    }
    importing = true;
    return work.run(async () => {
      try {
        guard();
        const status = await transport.status();
        if (!current(guard)) return false;
        const rawVersion = record(status) ? status.bridgeVersion : undefined;
        const version =
          typeof rawVersion === 'number' || typeof rawVersion === 'string'
            ? Number(rawVersion)
            : NaN;
        if (!Number.isSafeInteger(version) || version < protocol.minimumBridgeVersion)
          throw new Error('יש להריץ מחדש install_bank_bridge.bat במחשב זה לפני ייבוא הגדרות');
        const selected = await selection.choose();
        if (!current(guard) || selected === null) return false;
        const { payload, summary } = document.prepare(selected);
        guard();
        if (
          !Number.isSafeInteger(summary.bankAccountCount) ||
          summary.bankAccountCount < 0 ||
          !Number.isSafeInteger(summary.creditProfileCount) ||
          summary.creditProfileCount < 1
        )
          throw new TypeError('finance_connection_import_summary_invalid');
        const approved = await presentation.confirm(
          'ייבוא מלא של חיבורי בנק ואשראי',
          `הייבוא יחליף במחשב הזה את פרטי ההתחברות המקומיים לבנק ואת כל חיבורי האשראי. נמצאו ${summary.bankAccountCount} חשבונות בנק ו-${summary.creditProfileCount} חיבורי אשראי. מפתח ה-Bridge הקיים לא ישתנה.`,
          { confirmText: 'ייבא הגדרות' }
        );
        if (!current(guard) || approved !== true) return false;
        const result = await transport.replace(payload);
        if (!current(guard)) return false;
        await presentation.publish(result, guard);
        if (!current(guard)) return false;
        const cleanupWarnings =
          record(result) && Array.isArray(result.cleanupWarnings) ? result.cleanupWarnings : [];
        presentation.toast(
          cleanupWarnings.length
            ? 'הייבוא נשמר במחשב, אך ניקוי מצב ישן לא הושלם במלואו. מומלץ להפעיל מחדש את Bank Bridge לפני הסינכרון הבא.'
            : `הייבוא הושלם: ${summary.creditProfileCount} חיבורי אשראי והגדרות הבנק נשמרו מוצפנים במחשב`
        );
        return true;
      } catch (error) {
        if (current(guard)) presentation.toast(message(error));
        return false;
      } finally {
        importing = false;
      }
    });
  }
  const runtime = {
    isPending: () => work.isPending() || selection.runtime.isPending(),
    async drain() {
      do {
        await Promise.all([work.drain(), selection.runtime.drain()]);
      } while (runtime.isPending());
    },
    dispose() {
      if (!work.close()) return false;
      scope.dispose();
      selection.runtime.dispose();
      return true;
    },
  };
  return { commands: { importConnections }, runtime };
}
