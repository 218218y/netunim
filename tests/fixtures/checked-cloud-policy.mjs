import {createOutboxRecord,migrateOutboxRecord,normalizeCloudError,createCloudRetryControl,createDataApiScheduler,runBusyCloudWriteWithPolicy} from '../../shared/cloud-sync.js';
/** @type {unknown} */ const wire={};
const migrated=migrateOutboxRecord(wire);
if(migrated){
  /** @type {number} */ const seq=migrated.mutationSeq;
  // @ts-expect-error Migrated data is not a validated business document.
  migrated.snapshot.notes.map(row=>row.id);
  // @ts-expect-error Retry attempts cannot become textual success.
  /** @type {string} */ const wrong=migrated.retry.attempts;
  void [seq,wrong];
}
const normalized=createOutboxRecord({generation:1,snapshot:wire});
/** @type {number} */ const generation=normalized.generation;
// @ts-expect-error A normalized snapshot retains unknown provenance.
/** @type {{notes:object[]}} */ const unvalidated=normalized.snapshot;
const error=normalizeCloudError(wire);
/** @type {import('../../shared/cloud-sync.js').CloudErrorKind} */ const kind=error.kind;
// @ts-expect-error An arbitrary status string is not a classified cloud failure.
/** @type {import('../../shared/cloud-sync.js').CloudErrorKind} */ const badKind='saved';
const retry=createCloudRetryControl(wire);
/** @type {string|null} */ const deadline=retry.nextAttemptAt;
// @ts-expect-error An error classification cannot authorize a cloud revision.
/** @type {number} */ const revision=error.kind;
/** @type {ReturnType<typeof createDataApiScheduler<Response>>} */ const scheduler=createDataApiScheduler();
/** @type {Promise<Response>} */ const response=scheduler.schedule(()=>Promise.resolve(new Response()),{priority:'high'});
// @ts-expect-error A coalescing scheduler has one result contract for every key.
scheduler.schedule(()=>true,{key:'document'});
// @ts-expect-error Starting a task is not a completed response.
/** @type {Response} */ const premature=response;
// @ts-expect-error Only high and low are supported request priorities.
scheduler.schedule(()=>new Response(),{priority:'urgent'});
/** @type {Promise<Response|null>} */ const retried=runBusyCloudWriteWithPolicy(async()=>new Response());
void [generation,unvalidated,kind,badKind,deadline,revision,premature,retried];
