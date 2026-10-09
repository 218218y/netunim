// Compile-only consumers of actual canonical and generated decoder bodies.
import {readStorageCloudBase,readStorageCloudFlight,readStorageCloudControl,readStorageCloudHead} from '../../shared/storage-cloud-records.js';
import {readStorageCloudHead as readKupaHead} from '../../netunim-kupa/site/assets/js/shared/storage-cloud-records.js';
import {readStorageCloudHead as readOrdersHead} from '../../netunim-orders/site/assets/js/shared/storage-cloud-records.js';
/** @type {unknown} */ const input={};
const base=readStorageCloudBase(input),flight=readStorageCloudFlight(input),control=readStorageCloudControl(input);
/** @type {number} */ const revision=base.revision;
/** @type {number} */ const endSeq=flight.endSeq;
/** @type {string} */ const operationId=flight.operationId;
/** @type {2} */ const version=control.version;
/** @type {number|null|undefined} */ const generation=flight.generation;
const records={base:input,flight:input,control:input},scope={owner:'account',epoch:'epoch',seq:1};
const head=readStorageCloudHead(records,scope);readKupaHead(records,scope);readOrdersHead(records,scope);
if(head.flight){/** @type {string} */ const id=head.flight.operationId;void id}
// @ts-expect-error sequences are numeric, never wire text
readStorageCloudHead(records,{...scope,seq:'1'});
// @ts-expect-error journal epoch is textual, not the login epoch
readStorageCloudHead(records,{...scope,epoch:1});
// @ts-expect-error owner is mandatory
readStorageCloudHead(records,{epoch:'epoch',seq:1});
// @ts-expect-error a scoped head may have no cloud base
head.base.revision.toFixed();
// @ts-expect-error historical generation may be absent/null
flight.generation.toFixed();
// @ts-expect-error historical audit may be absent/null
flight.audit.connector.toUpperCase();
// @ts-expect-error JSON snapshot content is not an inferred business model
flight.snapshot.notes[0].id.toUpperCase();
// @ts-expect-error an operation ID cannot be numeric
/** @type {number} */ const wrongId=flight.operationId;
// @ts-expect-error cloud revisions cannot be wire text
/** @type {string} */ const wrongRevision=base.revision;
// @ts-expect-error retry may be absent/null
control.retry.attempts.toFixed();
// @ts-expect-error historical retry count may be absent/null
if(control.retry)control.retry.attempts.toFixed();
// @ts-expect-error conflict is opaque JSON, not an inferred resolution plan
if(control.conflict)control.conflict.kind.toUpperCase();
// @ts-expect-error a deadline is text when present
/** @type {number} */ const wrongDeadline=control.retry?.nextAttemptAt;
void revision;void endSeq;void operationId;void version;void generation;void wrongId;void wrongRevision;void wrongDeadline;
