// Compile-only consumers of the actual persisted operation decoder.
import {readStorageOperation,validateStoredOperation} from '../../shared/storage-operation.js';
import {readStorageOperation as readKupaOperation} from '../../netunim-kupa/site/assets/js/shared/storage-operation.js';
import {readStorageOperation as readOrdersOperation} from '../../netunim-orders/site/assets/js/shared/storage-operation.js';
import {readStorageJsonRecord} from '../../shared/storage-json-codec.js';

/** @type {unknown} */ const untrusted={};
const schema={collections:['notes'],fields:['setting']};
const decoded=readStorageOperation(untrusted,schema);
validateStoredOperation(untrusted,schema);readKupaOperation(untrusted,schema);readOrdersOperation(untrusted,schema);
/** @type {number} */ const seq=decoded.seq;
/** @type {string} */ const id=decoded.operationId;
/** @type {2} */ const version=decoded.version;
/** @type {string | null | undefined} */ const surface=decoded.surface;
const change=decoded.changes[0];
if(change){
  if(change.type==='put'){
    /** @type {string} */ const recordId=change.record.id;
    if(change.mode==='insert'){/** @type {number} */ const index=change.index;void index}
    // @ts-expect-error the decoder does not infer business content
    change.record.content.toUpperCase();
    if(change.mode==='replace'){
      // @ts-expect-error historical replacement indices are not validated ordering authority
      /** @type {number} */ const index=change.index;
      void index;
    }
    void recordId;
  }
  if(change.type==='delete'){
    // @ts-expect-error a deletion carries an ID, not a record to upsert
    change.record.id.toUpperCase();
  }
  if(change.type==='set'){
    // @ts-expect-error a scalar assignment does not name a collection
    change.collection.toUpperCase();
  }
  if(change.type==='replace-state'){
    // @ts-expect-error a replacement state has no inferred business schema
    change.state.notes[0].id.toUpperCase();
  }
}
// @ts-expect-error checksummed JSON has not been decoded as an operation
readStorageJsonRecord(untrusted).operationId.toUpperCase();
// @ts-expect-error historical metadata may be absent/null
decoded.appMetadata.boundaryId.toUpperCase();
// @ts-expect-error historical deletion intent metadata may be absent/null
decoded.deleteIntents.notes.map(id=>id.toUpperCase());
// @ts-expect-error historical surface may be absent/null
decoded.surface.toUpperCase();
// @ts-expect-error historical mutation type may be absent/null
decoded.mutationType.toUpperCase();
// @ts-expect-error safe sequence is a number, not wire text
/** @type {string} */ const wrongSeq=decoded.seq;
// @ts-expect-error a stored operation ID cannot be numeric
/** @type {number} */ const wrongId=decoded.operationId;
// @ts-expect-error a successful decoder returns only version 2
/** @type {1} */ const wrongVersion=decoded.version;
// @ts-expect-error a changes array can be non-empty without a statically fixed first slot
decoded.changes[0].type.toUpperCase();
// @ts-expect-error schema collection names must be strings
readStorageOperation(untrusted,{collections:[1]});
// @ts-expect-error schema field names must be strings
readStorageOperation(untrusted,{fields:[1]});
// @ts-expect-error generated Kupa decoding retains nullable annotations
readKupaOperation(untrusted,schema).surface.toUpperCase();
// @ts-expect-error generated Orders decoding rejects a string generation claim
/** @type {string} */ const wrongGeneration=readOrdersOperation(untrusted,schema).generation;
void seq;void id;void version;void surface;
