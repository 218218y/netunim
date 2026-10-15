// @ts-check
import { decodePdfExtractionResponse } from './pdf-extraction-result.mjs';
/** @typedef {import('./pdf-extraction-result.mjs').PdfExtractionResult} PdfExtractionResult
 * @typedef {{unref?:()=>unknown}} TimerHandle
 * @typedef {{output:(chunk:string)=>void,errorOutput:(chunk:string)=>void,error:(error:unknown)=>void,close:(code:number|null)=>void}} WorkerEvents
 * @typedef {{worker:{start:(request:{fullPath:string,includePageText:boolean},events:WorkerEvents)=>{kill:()=>void}},
 * runtime:{setTimeout:(callback:()=>void,ms:number)=>TimerHandle,clearTimeout:(handle:TimerHandle)=>void}}} ExtractionProcessPorts
 * @typedef {{timeoutMs?:number,maxOutputChars?:number,maxErrorChars?:number}} ExtractionProcessLimits
 * @typedef {{read:(file:string,options?:{includePageText?:boolean,signal?:AbortSignal|null})=>Promise<PdfExtractionResult>,dispose:()=>Promise<void>}} PdfExtractionProcess
 */
/** @param {ExtractionProcessPorts} ports @param {ExtractionProcessLimits} [limits] @returns {PdfExtractionProcess} */
export function createPdfExtractionProcess(
  { worker, runtime },
  {
    timeoutMs = 25000,
    maxOutputChars = 32 * 1024 * 1024,
    maxErrorChars = 4096
  } = {}
) {
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(maxOutputChars) ||
    maxOutputChars < 1 ||
    !Number.isSafeInteger(maxErrorChars) ||
    maxErrorChars < 0
  )
    throw new Error('PDF extraction process limits are invalid.');
  let disposed = false;
  /** @type {Set<{cancel:()=>void,done:Promise<void>}>} */ const pending =
    new Set();
  /** @param {string} file @param {{includePageText?:boolean,signal?:AbortSignal|null}} [options] @returns {Promise<PdfExtractionResult>} */
  function read(file, { includePageText = true, signal = null } = {}) {
    if (disposed)
      return Promise.reject(
        Object.assign(new Error('PDF extraction process is closing.'), {
          code: 'PDF_EXTRACTION_DISPOSED'
        })
      );
    if (signal?.aborted)
      return Promise.reject(
        Object.assign(new Error('PDF extraction aborted'), {
          name: 'AbortError',
          code: 'ABORT_ERR'
        })
      );
    /** @type {()=>void} */ let cancel = () => {};
    /** @type {Promise<PdfExtractionResult>} */ const task = new Promise(
      (resolve, reject) => {
        let output = '',
          errors = '',
          closed = false,
          failed = false;
        /** @type {unknown} */ let failure;
        /** @type {{kill:()=>void}|null} */ let child = null;
        /** @type {TimerHandle|null} */ let timer = null;
        /** Store the first cause, but do not release authority before child close.
         * @param {unknown} error @param {boolean} [kill] */
        function fail(error, kill = false) {
          if (closed) return;
          if (!failed) {
            failed = true;
            failure = error;
          }
          if (kill)
            try {
              child?.kill();
            } catch {}
        }
        const abort = () =>
          fail(
            Object.assign(new Error('PDF extraction aborted'), {
              name: 'AbortError',
              code: 'ABORT_ERR'
            }),
            true
          );
        cancel = () =>
          fail(
            Object.assign(new Error('PDF extraction process is closing.'), {
              code: 'PDF_EXTRACTION_DISPOSED'
            }),
            true
          );
        /** @param {number|null} code */
        function finish(code) {
          if (closed) return;
          closed = true;
          if (timer) runtime.clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          if (failed) {
            reject(failure);
            return;
          }
          try {
            resolve(decodePdfExtractionResponse(output, errors, code));
          } catch (error) {
            reject(error);
          }
        }
        try {
          child = worker.start(
            { fullPath: file, includePageText },
            {
              output: chunk => {
                if (closed || failed) return;
                if (output.length + chunk.length > maxOutputChars) {
                  fail(new Error('PDF worker output too large'), true);
                  return;
                }
                output += chunk;
              },
              errorOutput: chunk => {
                if (!closed)
                  errors += chunk.slice(
                    0,
                    Math.max(0, maxErrorChars - errors.length)
                  );
              },
              error: error => fail(error, true),
              close: finish
            }
          );
          if (closed) return;
          timer = runtime.setTimeout(
            () => fail(new Error('PDF on-demand extraction timed out'), true),
            timeoutMs
          );
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
          // A platform may synchronously report a pipe error while starting.
          if (failed)
            try {
              child.kill();
            } catch {}
        } catch (error) {
          fail(error);
          finish(null);
        }
      }
    );
    const done = task.then(
        () => {},
        () => {}
      ),
      flight = { cancel: () => cancel(), done };
    pending.add(flight);
    void done.then(() => pending.delete(flight));
    return task;
  }
  /** @returns {Promise<void>} */
  async function dispose() {
    disposed = true;
    for (const flight of pending) flight.cancel();
    await Promise.all([...pending].map(flight => flight.done));
  }
  return { read, dispose };
}
