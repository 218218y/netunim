// Compile-only trust-boundary consumers; never execute negative calls.
import {assertStorageJson,sealStorageJsonRecord,readStorageJsonRecord,storageChecksum} from '../../shared/storage-json-codec.js';
import {readStorageCheckpoint} from '../../shared/storage-checkpoint.js';
import {createStorageCheckpoint} from '../../shared/storage-records.js';
import {readStorageCheckpoint as readKupaCheckpoint} from '../../netunim-kupa/site/assets/js/shared/storage-checkpoint.js';
import {readStorageCheckpoint as readOrdersCheckpoint} from '../../netunim-orders/site/assets/js/shared/storage-checkpoint.js';

const current=createStorageCheckpoint({owner:'account:kupa',epoch:'epoch',seq:3,state:{notes:[{id:'N',text:'retained'}]},appMetadata:{storageRole:'primary'},savedAt:'stamp'});
const sealed=sealStorageJsonRecord(current);
/** @type {string} */ const checksum=sealed.checksum;
/** @type {number} */ const writerSeq=sealed.data.seq;
const first=sealed.data.state.notes[0];if(first){/** @type {string} */ const id=first.id;void id}
/** @type {unknown} */ const untrusted=sealed;
const decoded=readStorageCheckpoint(untrusted);
readKupaCheckpoint(untrusted);readOrdersCheckpoint(untrusted);
/** @type {number} */ const seq=decoded.seq;
/** @type {string} */ const owner=decoded.owner;
/** @type {string} */ const epoch=decoded.epoch;
/** @type {2} */ const version=decoded.version;
/** @type {import('../../shared/storage-json.js').StorageJsonObject | null | undefined} */ const metadata=decoded.appMetadata;
const json=readStorageJsonRecord(untrusted);
assertStorageJson(untrusted);storageChecksum('sealed bytes');
// @ts-expect-error a checksum-valid JSON envelope is not automatically a checkpoint
json.seq.toFixed();
// @ts-expect-error a validated reader does not infer a business note schema
decoded.state.notes[0].id.toUpperCase();
// @ts-expect-error historical metadata can be missing or null
decoded.appMetadata.storageRole.toUpperCase();
// @ts-expect-error a decoder cannot assume the current writer always emitted savedAt
/** @type {string} */ const stamp=decoded.savedAt;
// @ts-expect-error a checkpoint sequence is not a string timestamp
/** @type {string} */ const wrongSeq=decoded.seq;
// @ts-expect-error the decoder guarantees version 2 only
/** @type {1} */ const wrongVersion=decoded.version;
// @ts-expect-error JSON sealing cannot persist callbacks
sealStorageJsonRecord({callback:()=>{}});
// @ts-expect-error Date must be projected by the business owner before sealing
sealStorageJsonRecord({date:new Date()});
// @ts-expect-error undefined cannot be sanitized silently
sealStorageJsonRecord({missing:undefined});
// @ts-expect-error Map is not a JSON object
sealStorageJsonRecord({mapping:new Map()});
// @ts-expect-error checksum text must already be serialized
storageChecksum(current);
// @ts-expect-error arbitrary instrumentation cannot change the measured result
sealStorageJsonRecord(current,{measure:()=> 'changed'});
// @ts-expect-error serialized callback is synchronous and observed before sealing finishes
sealStorageJsonRecord(current,{onSerialized:async()=>{}});
// @ts-expect-error record kind is a metric label, not a numeric schema version
sealStorageJsonRecord(current,{kind:2});
// @ts-expect-error generated Kupa checkpoint decoding checks numeric sequence
/** @type {string} */ const wrongKupaSeq=readKupaCheckpoint(untrusted).seq;
// @ts-expect-error generated Orders checkpoint decoding retains nullable metadata
readOrdersCheckpoint(untrusted).appMetadata.storageRole.toUpperCase();
void checksum;void writerSeq;void seq;void owner;void epoch;void version;void metadata;
