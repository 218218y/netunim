// @ts-check
/** @typedef {import('./preview-text-cache.mjs').PreviewFormField} FormField
 * @typedef {import('./result-registry.mjs').DocumentRow & {fingerprint:string}} WorkRow
 * @typedef {WorkRow & {rootId:'everything',rootLabel:'Everything',hasForm:boolean,text:string,formFields:FormField[],formFieldCount:number,failed:boolean,error:string,retryAfter:string,retryCount:number,detectionRevision:number,searchTextRevision:number,geometryRevision:number,fileMtimeMs?:number}} PdfEntry
 * @typedef {{lastAttemptAt?:string|null,lastSuccessfulAt?:string|null,lastFailureAt?:string|null,lastFailure?:string|null,lastReconcileAt?:string|null,lastIncrementalScanAt?:string|null,lastResult?:Record<string,unknown>|null,[key:string]:unknown}} MaintenanceRecord
 * @typedef {{processed:number,pending:number,skipped?:boolean,reason?:string,aborted?:boolean,[key:string]:unknown}} RefreshResult
 * @typedef {{phase:'start'|'file',pdfCount:number,changed:number,selected:number,processed:number,indexed:number,failed:number,name?:string}} MaintenanceProgress
 * @typedef {{maxChanged?:number,maxMs?:number,onProgress?:((progress:MaintenanceProgress)=>void)|null,force?:boolean,reason?:string}} RefreshOptions
 * @typedef {{signal:AbortSignal|null,full:boolean,modifiedSince:string}} InventoryOptions
 * @typedef {{pdfCount:number,changed:number,removed:number,rows:WorkRow[]}} InventoryBatch
 * @typedef {{unref?:()=>unknown}} TimerHandle
 * @typedef {{user:number,system:number}} CpuUsage
 * @typedef {{PDF_FORM_MAINTENANCE_MAX_FILES:number,PDF_FORM_MAINTENANCE_MAX_MS:number,PDF_FORM_MAINTENANCE_INTERVAL_MS:number,PDF_FORM_RECONCILE_INTERVAL_MS:number,PDF_FORM_RETRY_MS:number,PDF_FORM_MAX_BYTES:number,PDF_FORM_DETECTION_REVISION:number,PDF_FORM_SEARCH_TEXT_REVISION:number,PDF_FORM_GEOMETRY_REVISION:number}} MaintenanceLimits
 * @typedef {{index:{load:()=>Promise<void>,entries:ReadonlyMap<string,PdfEntry>,view:()=>{pending:number,pdfCount:number},publishPending:(pending:number)=>void,
 * append:(records:Array<{op:'upsert',entry:Record<string,unknown>&{fullPath:string}}>)=>Promise<void>,serialize:(entry:PdfEntry)=>Record<string,unknown>&{fullPath:string},compact:(counts:{pending:number,pdfCount:number})=>Promise<void>},
 * inventory:{rebuild:(options:InventoryOptions)=>Promise<InventoryBatch>},
 * extraction:{read:(file:string,options:{maxBytes:number,signal:AbortSignal,onBytesRead:(count:number)=>void})=>Promise<{hasForm:boolean,text:string,formFields:unknown,formFieldCount:number}>,stat:(file:string)=>Promise<{mtimeMs:number}|null>,fields:(value:unknown)=>FormField[]},
 * metadata:{read:()=>Promise<unknown>,write:(record:MaintenanceRecord)=>Promise<void>},
 * policy:{limits:MaintenanceLimits,plan:(input:{force:boolean,now:number,lastReconcileAt:string|null|undefined,lastIncrementalScanAt:string|null|undefined,reconcileIntervalMs:number})=>{full:boolean,modifiedSince:string}},
 * runtime:{now:()=>number,cpuUsage:(previous?:CpuUsage)=>CpuUsage,isStopping:()=>boolean,setTimeout:(callback:()=>void,ms:number)=>TimerHandle,clearTimeout:(handle:TimerHandle)=>void},audit:{write:(text:string)=>Promise<void>}}} MaintenancePorts
 * @typedef {{refresh:(options?:RefreshOptions)=>Promise<RefreshResult>,stop:()=>void,dispose:()=>Promise<void>}} PdfMaintenanceOperation
 */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const object = value =>
  !!value && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} error @param {string} key @returns {unknown} */
const errorField = (error, key) =>
  object(error) ? Reflect.get(error, key) : undefined;
/** @param {unknown} error */
const isAbortError = error =>
  errorField(error, 'name') === 'AbortError' ||
  String(errorField(error, 'code') || '') === 'ABORT_ERR';
/** @param {string} fullPath */
const pdfIndexKey = fullPath =>
  String(fullPath || '').toLocaleLowerCase('en-US');
/** @param {unknown} value @returns {MaintenanceRecord} */
export function decodePdfMaintenanceRecord(value) {
  if (!object(value))
    throw Object.assign(new Error('PDF maintenance metadata is invalid.'), {
      code: 'PDF_MAINTENANCE_METADATA_INVALID'
    });
  for (const key of [
    'lastAttemptAt',
    'lastSuccessfulAt',
    'lastFailureAt',
    'lastFailure',
    'lastReconcileAt',
    'lastIncrementalScanAt'
  ])
    if (
      value[key] !== undefined &&
      value[key] !== null &&
      typeof value[key] !== 'string'
    )
      throw Object.assign(new Error('PDF maintenance metadata is invalid.'), {
        code: 'PDF_MAINTENANCE_METADATA_INVALID'
      });
  if (
    value.lastResult !== undefined &&
    value.lastResult !== null &&
    !object(value.lastResult)
  )
    throw Object.assign(new Error('PDF maintenance metadata is invalid.'), {
      code: 'PDF_MAINTENANCE_METADATA_INVALID'
    });
  return { ...value };
}
/** @param {MaintenancePorts} ports @returns {PdfMaintenanceOperation} */
export function createPdfMaintenanceOperation({
  index,
  inventory: sourceInventory,
  extraction,
  metadata,
  policy,
  runtime,
  audit
}) {
  const {
    PDF_FORM_MAINTENANCE_MAX_FILES,
    PDF_FORM_MAINTENANCE_MAX_MS,
    PDF_FORM_MAINTENANCE_INTERVAL_MS,
    PDF_FORM_RECONCILE_INTERVAL_MS,
    PDF_FORM_RETRY_MS,
    PDF_FORM_MAX_BYTES,
    PDF_FORM_DETECTION_REVISION,
    PDF_FORM_SEARCH_TEXT_REVISION,
    PDF_FORM_GEOMETRY_REVISION
  } = policy.limits;
  let disposed = false;
  /** @type {Promise<RefreshResult>|null} */ let flight = null;
  /** @type {AbortController|null} */ let activeController = null;
  async function readMetadata() {
    return decodePdfMaintenanceRecord(await metadata.read());
  }
  /** @param {RefreshOptions} [options] @returns {Promise<RefreshResult>} */
  async function performRefresh({
    maxChanged = PDF_FORM_MAINTENANCE_MAX_FILES,
    maxMs = PDF_FORM_MAINTENANCE_MAX_MS,
    onProgress = null,
    force = false,
    reason = 'scheduled'
  } = {}) {
    if (disposed || runtime.isStopping())
      return {
        pdfCount: index.view().pdfCount,
        changed: index.view().pending,
        processed: 0,
        pending: index.view().pending,
        indexed: 0,
        failed: 0,
        removed: 0,
        cached: index.entries.size,
        interactive: [...index.entries.values()].filter(
          entry => entry.hasForm && !entry.failed
        ).length,
        aborted: true,
        elapsedMs: 0
      };

    const controller = new AbortController();
    activeController = controller;
    /** @type {WorkRow[]} */ let backlog = [];
    const boundedMaxMs = Number.isFinite(Number(maxMs))
      ? Math.max(0, Math.trunc(Number(maxMs)))
      : 0;
    const limitTimer =
      boundedMaxMs > 0
        ? runtime.setTimeout(() => controller.abort(), boundedMaxMs)
        : null;
    limitTimer?.unref?.();
    const task = (async () => {
      await index.load();
      const started = runtime.now(),
        cpuStarted = runtime.cpuUsage();
      let removed = 0,
        indexed = 0,
        failed = 0,
        processed = 0,
        aborted = false,
        bytesRead = 0;
      const maintenance = await readMetadata();
      if (
        !force &&
        !maintenance.lastFailureAt &&
        Number(maintenance.lastResult?.pending) === 0 &&
        Date.parse(String(maintenance.lastSuccessfulAt || '')) >
          started - PDF_FORM_MAINTENANCE_INTERVAL_MS
      )
        return {
          skipped: true,
          reason: 'not-due',
          pending: index.view().pending,
          processed: 0
        };
      maintenance.lastAttemptAt = new Date(started).toISOString();
      await metadata.write(maintenance);
      const { full, modifiedSince } = policy.plan({
        force,
        now: started,
        lastReconcileAt: maintenance.lastReconcileAt,
        lastIncrementalScanAt: maintenance.lastIncrementalScanAt,
        reconcileIntervalMs: PDF_FORM_RECONCILE_INTERVAL_MS
      });
      const inventory = await sourceInventory.rebuild({
        signal: controller.signal,
        full,
        modifiedSince
      });
      removed = inventory.removed;
      backlog = inventory.rows;
      if (disposed || runtime.isStopping() || controller.signal.aborted) {
        throw Object.assign(new Error('PDF maintenance stopped'), {
          code: 'ABORT_ERR'
        });
      }
      const changedBefore = backlog.length,
        boundedMax = Number.isFinite(Number(maxChanged))
          ? Math.max(0, Math.trunc(Number(maxChanged)))
          : changedBefore;
      const selected = backlog.splice(0, boundedMax);
      if (typeof onProgress === 'function')
        onProgress({
          phase: 'start',
          pdfCount: index.view().pdfCount,
          changed: changedBefore,
          selected: selected.length,
          processed: 0,
          indexed,
          failed
        });
      for (const row of selected) {
        if (
          disposed ||
          runtime.isStopping() ||
          controller.signal.aborted ||
          (boundedMaxMs > 0 && runtime.now() - started >= boundedMaxMs)
        ) {
          aborted = true;
          break;
        }
        const key = pdfIndexKey(row.fullPath);
        /** @type {PdfEntry} */ let entry;
        try {
          const extracted = await extraction.read(row.fullPath, {
            maxBytes: PDF_FORM_MAX_BYTES,
            signal: controller.signal,
            onBytesRead: count => {
              bytesRead += count;
            }
          });
          const fileStat = await extraction
            .stat(row.fullPath)
            .catch(() => null);
          entry = {
            ...row,
            rootId: 'everything',
            rootLabel: 'Everything',
            fingerprint: row.fingerprint,
            fileMtimeMs: fileStat?.mtimeMs || 0,
            detectionRevision: PDF_FORM_DETECTION_REVISION,
            searchTextRevision: PDF_FORM_SEARCH_TEXT_REVISION,
            geometryRevision: PDF_FORM_GEOMETRY_REVISION,
            hasForm: !!extracted.hasForm,
            text: extracted.hasForm ? extracted.text : '',
            formFields: extracted.hasForm
              ? extraction.fields(extracted.formFields)
              : [],
            formFieldCount: extracted.hasForm ? extracted.formFieldCount : 0,
            failed: false,
            error: '',
            retryAfter: '',
            retryCount: 0
          };
        } catch (error) {
          if (
            isAbortError(error) ||
            disposed ||
            runtime.isStopping() ||
            controller.signal.aborted
          ) {
            aborted = true;
            break;
          }
          const previous = index.entries.get(key),
            retryCount =
              previous?.fingerprint === row.fingerprint
                ? Math.min(8, (previous.retryCount || 0) + 1)
                : 1;
          const retryMs = /No password given/i.test(
            String(errorField(error, 'message') || '')
          )
            ? 30 * PDF_FORM_RETRY_MS
            : Math.min(
                7 * PDF_FORM_RETRY_MS,
                PDF_FORM_RETRY_MS * 2 ** (retryCount - 1)
              );
          entry = {
            ...row,
            rootId: 'everything',
            rootLabel: 'Everything',
            fingerprint: row.fingerprint,
            detectionRevision: PDF_FORM_DETECTION_REVISION,
            searchTextRevision: PDF_FORM_SEARCH_TEXT_REVISION,
            geometryRevision: 0,
            hasForm: false,
            text: '',
            formFields: [],
            formFieldCount: 0,
            failed: true,
            error: String(errorField(error, 'message') || error),
            retryAfter: new Date(runtime.now() + retryMs).toISOString(),
            retryCount
          };
          failed += 1;
          await audit.write(
            `PDF_FORM_INDEX_FILE_FAILED path=${JSON.stringify(row.fullPath)} error=${JSON.stringify(String(errorField(error, 'message') || error))}`
          );
        }
        await index.append([{ op: 'upsert', entry: index.serialize(entry) }]);
        if (entry.hasForm && !entry.failed) indexed += 1;
        processed += 1;
        if (typeof onProgress === 'function')
          onProgress({
            phase: 'file',
            pdfCount: index.view().pdfCount,
            changed: changedBefore,
            selected: selected.length,
            processed,
            indexed,
            failed,
            name: row.name
          });
      }
      if (processed < selected.length)
        backlog.unshift(...selected.slice(processed));
      const pending = backlog.length;
      index.publishPending(pending);
      await index.compact({ pending, pdfCount: index.view().pdfCount });
      if (!aborted && pending === 0) {
        maintenance.lastIncrementalScanAt = new Date(started).toISOString();
        if (full) maintenance.lastReconcileAt = new Date(started).toISOString();
        maintenance.lastSuccessfulAt = new Date(runtime.now()).toISOString();
      }
      delete maintenance.lastFailureAt;
      delete maintenance.lastFailure;
      maintenance.lastResult = {
        reason,
        full,
        modifiedSince,
        pdfCount: inventory.pdfCount,
        changed: changedBefore,
        processed,
        pending,
        indexed,
        failed,
        removed,
        bytesRead,
        aborted,
        elapsedMs: runtime.now() - started
      };
      await metadata.write(maintenance);
      const interactive = [...index.entries.values()].filter(
        entry => entry.hasForm && !entry.failed
      ).length;
      const cpu = runtime.cpuUsage(cpuStarted),
        elapsedMs = runtime.now() - started;
      await audit.write(
        `PDF_FORM_INDEX_MAINTENANCE trigger=${reason} mode=${full ? 'reconcile' : 'incremental'} pdfs=${inventory.pdfCount} changed=${changedBefore} processed=${processed} pending=${pending} inspected=${index.entries.size} interactive=${interactive} indexed=${indexed} failed=${failed} removed=${removed} bytesRead=${bytesRead} cpuMs=${Math.round((cpu.user + cpu.system) / 1000)} aborted=${aborted} elapsedMs=${elapsedMs}`
      );
      return {
        pdfCount: inventory.pdfCount,
        changed: changedBefore,
        processed,
        pending,
        indexed,
        failed,
        removed,
        cached: index.entries.size,
        interactive,
        aborted,
        bytesRead,
        cpuMs: Math.round((cpu.user + cpu.system) / 1000),
        elapsedMs
      };
    })();

    try {
      return await task;
    } catch (error) {
      /** @type {MaintenanceRecord} */ let maintenance;
      try {
        maintenance = await readMetadata();
      } catch {
        throw error;
      }
      if (controller.signal.aborted || isAbortError(error)) {
        const result = {
          aborted: true,
          processed: 0,
          pending: index.view().pending,
          elapsedMs:
            runtime.now() -
            Date.parse(
              maintenance.lastAttemptAt || new Date(runtime.now()).toISOString()
            )
        };
        maintenance.lastResult = { reason, ...result };
        delete maintenance.lastFailureAt;
        delete maintenance.lastFailure;
        await metadata.write(maintenance).catch(() => {});
        await audit.write(
          `PDF_FORM_INDEX_MAINTENANCE_STOPPED trigger=${reason} pending=${result.pending}`
        );
        return result;
      }
      maintenance.lastFailureAt = new Date(runtime.now()).toISOString();
      maintenance.lastFailure = String(errorField(error, 'message') || error);
      await metadata.write(maintenance).catch(() => {});
      await audit.write(
        `PDF_FORM_INDEX_MAINTENANCE_FAILED trigger=${reason} error=${JSON.stringify(maintenance.lastFailure)}`
      );
      throw error;
    } finally {
      if (limitTimer) runtime.clearTimeout(limitTimer);
      if (activeController === controller) activeController = null;
    }
  }
  /** @param {RefreshOptions} [options] @returns {Promise<RefreshResult>} */
  function refresh(options = {}) {
    if (disposed)
      return Promise.reject(
        Object.assign(new Error('PDF maintenance operation is closing.'), {
          code: 'PDF_MAINTENANCE_DISPOSED'
        })
      );
    if (flight) return flight;
    const task = performRefresh(options);
    flight = task;
    const clear = () => {
      if (flight === task) flight = null;
    };
    void task.then(clear, clear);
    return task;
  }
  function stop() {
    activeController?.abort();
  }
  async function dispose() {
    disposed = true;
    stop();
    if (flight)
      await flight.then(
        () => {},
        () => {}
      );
  }
  return { refresh, stop, dispose };
}
