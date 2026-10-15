import {applyStorageV2RestoreGroup} from '../../shared/storage-v2-restore.js';
import {applyStorageV2LocalImport} from '../../shared/storage-v2-local-import.js';
import {readStorageBoundary} from '../../shared/storage-operation.js';
/** @type {unknown} */ const external={phase:'prepared'};
const record=readStorageBoundary(external,'A');
if(record&&record.phase!=='complete') {
  /** @type {number|undefined} */ exportSequence(record.main.expectedSeq);
}
/** @param {number|undefined} value */ function exportSequence(value) { return value; }
// @ts-expect-error Unknown persisted input cannot supply transaction authority.
external.main.state;
// @ts-expect-error Completed markers intentionally lack replacement state.
if(record?.phase==='complete')record.main.state;
const boundary={run:async(/** @type {import('../../shared/storage-operation.js').BoundaryIntent} */ intent)=>intent.id};
export const imported=applyStorageV2LocalImport({boundary,mode:'local-only',mainLocal:{seq:0},sharedLocal:{seq:0},mainState:{},sharedState:{}});
// @ts-expect-error Boundary writes must be awaited, not synchronous ACKs.
applyStorageV2RestoreGroup({boundary:{run:()=>true}});
// @ts-expect-error A textual mode cannot silently choose an owner policy.
applyStorageV2LocalImport({boundary,mode:'maybe'});
// @ts-expect-error Boundary identities remain strings.
applyStorageV2LocalImport({boundary,id:4});
