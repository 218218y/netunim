// @ts-check
import { decodePdfExtractionResult } from './pdf-extraction-result.mjs';
/** @typedef {import('./pdf-maintenance-operation.mjs').PdfEntry} PdfEntry
 * @typedef {import('./result-registry.mjs').StoredResult} PreviewRow
 * @typedef {import('./preview-text-cache.mjs').PreviewFormField} FormField
 * @typedef {{size:number,mtimeMs:number,mtime:Date}} PreviewStat
 * @typedef {{text:string,truncated:boolean,formFields:FormField[]}} PdfPreviewData
 * @typedef {{index:{load:()=>Promise<void>,get:(key:string)=>PdfEntry|undefined,append:(entry:PdfEntry)=>Promise<void>},
 * extraction:{read:(fullPath:string,options:{includePageText:boolean,signal:AbortSignal})=>Promise<unknown>},
 * paths:{basename:(file:string)=>string,dirname:(file:string)=>string},
 * presentation:{trim:(text:string)=>{text:string,truncated:boolean},fields:(fields:unknown)=>FormField[]},
 * policy:{detectionRevision:number,searchTextRevision:number,geometryRevision:number},audit:{write:(message:string)=>Promise<void>}}} PdfPreviewPorts
 * @typedef {{read:(row:PreviewRow,stat:PreviewStat)=>Promise<PdfPreviewData|null>,invalidate:(fullPath:string)=>Promise<void>,dispose:()=>Promise<void>}} PdfPreviewOperation
 * @typedef {{key:string,controller:AbortController,done:Promise<void>}} Flight
 */
/** @param {unknown} error */
const errorText = error =>
  String(
    error && typeof error === 'object'
      ? Reflect.get(error, 'message') || error
      : error
  );
function stopped() {
  return Object.assign(new Error('PDF preview operation is closing.'), {
    code: 'PDF_PREVIEW_DISPOSED'
  });
}
/** @param {PdfPreviewPorts} ports @returns {PdfPreviewOperation} */
export function createPdfPreviewOperation({
  index,
  extraction,
  paths,
  presentation,
  policy,
  audit
}) {
  let disposed = false;
  /** @type {Set<Flight>} */ const pending = new Set();
  /** @param {AbortSignal} signal */
  function assertCurrent(signal) {
    if (disposed || signal.aborted) throw stopped();
  }
  /** @param {PreviewRow} row @param {PreviewStat} stat @returns {import('./pdf-maintenance-operation.mjs').WorkRow} */
  function baseRow(row, stat) {
    const modified = row.modified || stat.mtime.toISOString();
    return {
      ...row,
      fullPath: row.fullPath,
      name: row.name || paths.basename(row.fullPath),
      relativePath: row.relativePath || paths.dirname(row.fullPath),
      modified,
      size: stat.size,
      extension: 'pdf',
      attributes: row.attributes || '',
      fingerprint: `${Number(stat.size) || 0}:${String(modified || '')}`
    };
  }
  /** @param {PreviewRow} row @param {PreviewStat} stat @param {AbortSignal} signal @returns {Promise<PdfPreviewData|null>} */
  async function perform(row, stat, signal) {
    const fullPath = row.fullPath;
    try {
      await index.load();
    } catch (error) {
      await audit.write(`PDF_FORM_INDEX_LOAD_FAILED ${errorText(error)}`);
      return null;
    }
    if (disposed || signal.aborted) return null;
    const cached = index.get(fullPath.toLocaleLowerCase('en-US')),
      detectionCurrent =
        Number(cached?.detectionRevision) === policy.detectionRevision;
    const cachedDate =
      Number(cached?.fileMtimeMs) || Date.parse(String(cached?.modified || ''));
    const fingerprintCurrent =
      !!cached &&
      Number(cached.size) === stat.size &&
      Number.isFinite(cachedDate) &&
      Math.abs(cachedDate - stat.mtimeMs) < 1000;
    if (
      fingerprintCurrent &&
      cached?.hasForm &&
      cached.text &&
      cached.formFields?.length &&
      Number(cached.searchTextRevision) >= policy.searchTextRevision &&
      Number(cached.geometryRevision) >= policy.geometryRevision
    )
      return {
        ...presentation.trim(cached.text),
        formFields: presentation.fields(cached.formFields)
      };
    if (
      fingerprintCurrent &&
      detectionCurrent &&
      cached &&
      !cached.hasForm &&
      !cached.failed
    )
      return null;
    try {
      const geometryOnly = !!(
        fingerprintCurrent &&
        cached?.hasForm &&
        cached.text &&
        Number(cached.searchTextRevision) >= policy.searchTextRevision &&
        (!cached.formFields?.length ||
          Number(cached.geometryRevision) < policy.geometryRevision)
      );
      const extracted = decodePdfExtractionResult(
        await extraction.read(fullPath, {
          includePageText: !geometryOnly,
          signal
        })
      );
      assertCurrent(signal);
      const base = fingerprintCurrent && cached ? cached : baseRow(row, stat);
      const text = extracted.hasForm
        ? geometryOnly && cached
          ? cached.text
          : extracted.text
        : '';
      const formFields = extracted.hasForm
        ? presentation.fields(extracted.formFields)
        : [];
      const data = extracted.hasForm
        ? { ...presentation.trim(text), formFields }
        : null;
      /** @type {PdfEntry} */ const updated = {
        ...base,
        rootId: 'everything',
        rootLabel: 'Everything',
        fileMtimeMs: stat.mtimeMs,
        detectionRevision: policy.detectionRevision,
        searchTextRevision:
          geometryOnly && extracted.hasForm && cached
            ? cached.searchTextRevision
            : policy.searchTextRevision,
        geometryRevision: extracted.hasForm ? policy.geometryRevision : 0,
        hasForm: extracted.hasForm,
        text,
        formFields,
        formFieldCount: extracted.hasForm
          ? extracted.formFieldCount || formFields.length
          : 0,
        failed: false,
        error: '',
        retryAfter: '',
        retryCount: 0
      };
      // Once admitted, the durable append is joined before invalidation removes it.
      await index.append(updated);
      return data;
    } catch (error) {
      if (!disposed && !signal.aborted)
        await audit.write(
          `PDF_FORM_PREVIEW_FAILED path=${JSON.stringify(fullPath)} error=${JSON.stringify(errorText(error))}`
        );
      return null;
    }
  }
  /** @param {PreviewRow} row @param {PreviewStat} stat @returns {Promise<PdfPreviewData|null>} */
  function read(row, stat) {
    if (disposed) return Promise.reject(stopped());
    const controller = new AbortController();
    const task = Promise.resolve().then(() => {
      assertCurrent(controller.signal);
      return perform(row, stat, controller.signal);
    });
    const done = task.then(
        () => {},
        () => {}
      ),
      flight = {
        key: row.fullPath.toLocaleLowerCase('en-US'),
        controller,
        done
      };
    pending.add(flight);
    void done.then(() => pending.delete(flight));
    return task;
  }
  /** Stop and join accepted work for this file before its durable removal.
   * @param {string} fullPath @returns {Promise<void>} */
  async function invalidate(fullPath) {
    const key = fullPath.toLocaleLowerCase('en-US'),
      flights = [...pending].filter(flight => flight.key === key);
    for (const flight of flights) flight.controller.abort();
    await Promise.all(flights.map(flight => flight.done));
  }
  /** @returns {Promise<void>} */
  async function dispose() {
    disposed = true;
    for (const flight of pending) flight.controller.abort();
    await Promise.all([...pending].map(flight => flight.done));
  }
  return { read, invalidate, dispose };
}
