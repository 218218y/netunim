// @ts-check
import { createRuntimeTaskOwner } from './runtime-task-owner.js';
/** @typedef {{choose:()=>Promise<unknown|null>,runtime:{isPending:()=>boolean,drain:()=>Promise<void>,dispose:()=>boolean}}} FinanceConnectionFileSelection */
/**
 * Owns the hidden native input/listeners and any file read accepted by change.
 * Disposal resolves an open picker but drains an already started file read.
 * @param {{decode:(raw:string)=>unknown,maxBytes:number,getDocument?:()=>Document}} ports
 * @returns {FinanceConnectionFileSelection}
 */
export function createFinanceConnectionFileSelection({
  decode,
  maxBytes,
  getDocument = () => globalThis.document,
}) {
  if (
    typeof decode !== 'function' ||
    typeof getDocument !== 'function' ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  )
    throw new TypeError('finance_connection_file_selection_ports_required');
  const work = createRuntimeTaskOwner();
  /** @type {{cancel:()=>void}|null} */ let pending = null;
  function choose() {
    if (!work.isActive() || pending) return Promise.resolve(null);
    return work.run(
      () =>
        new Promise((resolve, reject) => {
          const input = getDocument().createElement('input');
          input.type = 'file';
          input.accept = 'application/json,.json';
          input.hidden = true;
          let settled = false,
            reading = false;
          /** @param {unknown|null} value @param {unknown} [error] */
          function finish(value, error) {
            if (settled) return;
            settled = true;
            input.removeEventListener('cancel', cancel);
            input.removeEventListener('change', change);
            input.remove();
            if (pending === ticket) pending = null;
            if (error !== undefined) reject(error);
            else resolve(value);
          }
          const cancel = () => finish(null),
            ticket = { cancel };
          function change() {
            if (reading || settled || !work.isActive()) return;
            reading = true;
            const file = input.files?.[0];
            if (!file) {
              finish(null);
              return;
            }
            const accepted = work.run(async () => {
              try {
                if (Number(file.size) > maxBytes) throw new Error('קובץ הייבוא גדול מהגודל המותר');
                const raw = await file.text();
                if (!work.isActive() || settled || pending !== ticket) return;
                finish(decode(raw));
              } catch (error) {
                if (!settled) finish(null, error);
              }
            });
            void accepted.catch((error) => {
              if (!settled) finish(null, error);
            });
          }
          pending = ticket;
          input.addEventListener('cancel', cancel);
          input.addEventListener('change', change);
          try {
            getDocument().body.appendChild(input);
            input.click();
          } catch (error) {
            finish(null, error);
          }
        })
    );
  }
  return {
    choose,
    runtime: {
      isPending: () => !!pending || work.isPending(),
      drain: work.drain,
      dispose() {
        if (!work.close()) return false;
        pending?.cancel();
        return true;
      },
    },
  };
}
