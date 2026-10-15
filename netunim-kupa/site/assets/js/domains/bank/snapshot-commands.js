// @ts-check
import {
  readBankSnapshotReceipt,
  bankSnapshotReadoutIsCurrent,
} from '../../shared/bank-snapshot-receipt.js';

/** @typedef {() => undefined} SnapshotGuard */
/** @typedef {{snapshotToken:string,snapshotSeq:number,[field:string]:unknown}} BankSnapshot */
/** @typedef {{source?:string,accountNumber?:string|null,bankSyncAt?:string|null|undefined,bankFeed?:unknown,homeBankFeed?:unknown,message?:string}} ManualSnapshotOptions */
/** @typedef {{leaseName:'bank',leaseToken:string,fenceEpoch:number,assertCurrent:SnapshotGuard,[field:string]:unknown}} SnapshotLease */
/** @typedef {{phase:'saving'|'unconfirmed'|'blocked',canRetry:boolean,message:string}} LocalSnapshotState */
/** @template Archive @typedef {{bank:(bank:BankSnapshot)=>undefined,archive:(candidate:Archive|null)=>boolean|undefined,data:()=>undefined}} SnapshotPublication */

export const BANK_LOCAL_SAVE_WARNING =
  'לא התקבל אישור שמירה לנתוני הבנק. אין לסגור את החלון; יש לבדוק את מצב השמירה המקומית.';
export const BANK_READOUT_WARNING =
  'הנתונים נשמרו בענן בשלמותם, אך הרענון המקומי לאחר השמירה לא אומת. יש לרענן מהענן לפני סריקה נוספת.';
const MANUAL_SAVE_MESSAGE = 'יתרת העו״ש נשמרה כצילום מצב חדש';

/** @param {BankSnapshot} bank */
export function financeBankPayload(bank) {
  /** @type {Record<string,unknown>} */ const out = { ...bank };
  delete out.adjustments;
  delete out.snapshotToken;
  delete out.snapshotSeq;
  return out;
}

/**
 * Owns Bank durability and confirmed publication, without provider or browser IO.
 * The refresh operation owns provider commands/leases; the controller owns manual commands.
 * @template Archive
 * @param {{
 * authority:{capture:()=>SnapshotGuard},
 * bank:{mode:()=>string,manualCandidate:(numeric:number,options:ManualSnapshotOptions)=>BankSnapshot},
 * checks:{hasLocalWork:()=>boolean,saveCloud:(message:string)=>Promise<boolean>,syncCloud:(options:{quiet:true,required:true})=>Promise<boolean>},
 * local:{state:()=>LocalSnapshotState|null,save:(bank:BankSnapshot,message:string,guard:SnapshotGuard)=>Promise<boolean>,retry:()=>Promise<boolean>},
 * cloud:{publish:(bank:Record<string,unknown>,token:string,seq:number,lease:SnapshotLease)=>Promise<unknown>,refresh:(options:{assertCurrent:SnapshotGuard,minimumRevision:number,minimumFinanceRevision:number})=>Promise<unknown>},
 * publication:SnapshotPublication<Archive>
 * }} ports
 */
export function createKupaBankSnapshotCommands({
  authority,
  bank,
  checks,
  local,
  cloud,
  publication,
}) {
  /** @type {[string,unknown,string[]][]} */ const required = [
    ['authority', authority, ['capture']],
    ['bank', bank, ['mode', 'manualCandidate']],
    ['checks', checks, ['hasLocalWork', 'saveCloud', 'syncCloud']],
    ['local', local, ['state', 'save', 'retry']],
    ['cloud_snapshot', cloud, ['publish', 'refresh']],
    ['publication', publication, ['bank', 'archive', 'data']],
  ];
  for (const [name, port, methods] of required)
    for (const method of methods)
      if (typeof (/** @type {Record<string,unknown>} */ (port)?.[method]) !== 'function')
        throw new TypeError('kupa_bank_snapshot_' + name + '_' + method + '_required');

  /** @param {SnapshotGuard} assertCurrent */
  async function prepareBankSnapshot(assertCurrent) {
    assertCurrent();
    if (bank.mode() === 'supabase') {
      if (checks.hasLocalWork()) {
        const saved = await checks.saveCloud('הצקים סונכרנו לפני צילום יתרת הבנק');
        assertCurrent();
        if (!saved || checks.hasLocalWork())
          throw new Error('יש להמתין לסנכרון הצקים לפני צילום יתרת עו״ש חדש');
      }
      const synced = await checks.syncCloud({ quiet: true, required: true });
      assertCurrent();
      if (!synced)
        throw new Error(
          'צילום היתרה נעצר: לא ניתן לאמת שהצקים מסונכרנים כרגע. נסה שוב לאחר שהענן מסונכרן.'
        );
      if (checks.hasLocalWork()) {
        const saved = await checks.saveCloud('הצקים סונכרנו לפני צילום יתרת הבנק');
        assertCurrent();
        if (!saved || checks.hasLocalWork())
          throw new Error('יש להמתין לסנכרון הצקים לפני צילום יתרת עו״ש חדש');
      }
    }
  }
  /** @param {unknown} balance @param {ManualSnapshotOptions} [options] */
  async function commitBankSnapshot(balance, options = {}) {
    const assertCurrent = authority.capture();
    if (local.state()) return false;
    const numeric = Number(balance);
    if (!Number.isFinite(numeric)) throw new Error('התקבלה יתרת בנק לא תקינה');
    await prepareBankSnapshot(assertCurrent);
    assertCurrent();
    if (bank.mode() === 'supabase' && checks.hasLocalWork())
      throw new Error('הצקים השתנו לפני השמירה. יש להמתין לסנכרון ולנסות שוב.');
    const nextBank = bank.manualCandidate(numeric, options);
    const saved = await local.save(
      nextBank,
      options.message === undefined ? MANUAL_SAVE_MESSAGE : options.message,
      assertCurrent
    );
    assertCurrent();
    return saved;
  }
  /**
   * @param {BankSnapshot} nextBank @param {Archive|null} candidate @param {SnapshotLease} lease
   * @returns {Promise<{remoteCommitted:true,readoutVerified:boolean,receipt:import('../../shared/bank-snapshot-receipt.js').BankSnapshotReceipt}>}
   */
  async function publishCloud(nextBank, candidate, lease) {
    const assertCurrent = lease?.assertCurrent;
    if (typeof assertCurrent !== 'function')
      throw new TypeError('kupa_bank_snapshot_lease_scope_required');
    assertCurrent();
    if (bank.mode() !== 'supabase') throw new Error('kupa_bank_snapshot_cloud_mode_required');
    const committed = readBankSnapshotReceipt(
      await cloud.publish(
        financeBankPayload(nextBank),
        nextBank.snapshotToken,
        nextBank.snapshotSeq,
        lease
      )
    );
    assertCurrent();
    publication.bank(nextBank);
    publication.archive(candidate);
    publication.data();
    const refreshed = await cloud.refresh({
      assertCurrent,
      minimumRevision: committed.kupa_revision,
      minimumFinanceRevision: committed.finance_revision,
    });
    assertCurrent();
    return {
      remoteCommitted: true,
      readoutVerified: bankSnapshotReadoutIsCurrent(committed, refreshed),
      receipt: committed,
    };
  }
  /** @param {BankSnapshot} nextBank @param {string} message @param {SnapshotGuard} assertCurrent */
  async function publishLocal(nextBank, message, assertCurrent) {
    assertCurrent();
    if (bank.mode() === 'supabase') throw new Error('kupa_bank_snapshot_local_mode_required');
    const saved = await local.save(nextBank, message, assertCurrent);
    assertCurrent();
    if (saved !== true) throw new Error(BANK_LOCAL_SAVE_WARNING);
    return true;
  }
  return Object.freeze({
    commands: Object.freeze({
      prepare: prepareBankSnapshot,
      commitManual: commitBankSnapshot,
      publishCloud,
      publishLocal,
      retryLocal: local.retry,
    }),
    queries: Object.freeze({ localState: local.state }),
  });
}
