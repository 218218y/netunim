import {createStorageV2Boundary} from '../../shared/storage-v2-boundary.js';
import {readStorageBoundary} from '../../shared/storage-operation.js';
import {createStorageV2AccountMarker} from '../../shared/storage-v2-account-marker.js';
import {createStorageV2LocalBirth} from '../../shared/storage-v2-local-birth.js';
import {createStorageJournalDb} from '../../shared/storage-journal-idb.js';
const boundary=createStorageV2Boundary({owner:()=> 'A',primary:()=>true});
await boundary.run({id:'B',kind:'import',main:{kind:'replace-local-with-pending',state:{},expectedSeq:1,expectedBaseRevision:3,requireCleanCloud:true},
  shared:{kind:'replace-local-with-pending',state:{},expectedSeq:2,expectedBaseRevision:4,requireCleanCloud:true}});
// @ts-expect-error a pending import needs frozen sequence and revision
boundary.run({id:'B',kind:'import',main:{kind:'replace-local-with-pending',state:{}},shared:{kind:'replace-authoritative',state:{}}});
// @ts-expect-error a cloud reset needs a numeric revision
boundary.run({id:'B',kind:'restore',main:{kind:'reset-cloud-head',state:{},revision:'3'},shared:{kind:'replace-authoritative',state:{}}});
const record=readStorageBoundary(/** @type {unknown} */ ({}),'A');
if(record?.phase==='complete'){
  // @ts-expect-error compact completion has no retained replacement action
  record.main;
}else if(record){
  /** @type {string} */ const id=record.id;
  if(record.main.kind==='replace-local-with-pending'){
    /** @type {number} */ const revision=record.main.expectedBaseRevision;
    void revision;
  }
  void id;
}
createStorageV2AccountMarker({app:'orders',owner:()=> 'account',primary:()=>true});
// @ts-expect-error Marker ownership is an identity callback, not an authority boolean.
createStorageV2AccountMarker({app:'orders',owner:()=>true,primary:()=>true});
// @ts-expect-error A local birth source must return both journal states.
createStorageV2LocalBirth({readSource:async()=>({mainState:{}})});
// @ts-expect-error Local birth cannot skip Shared initialization and parity verification.
createStorageJournalDb().advanceLocalBirth('orders:local','birth','main-initialized','complete');
/** @type {import('../../shared/storage-journal-db.js').LocalBirthPlan} */
const historicalPlan={version:2,app:'orders',owner:'local',scope:'orders:local',id:'birth',phase:'prepared',
  mainState:{},sharedState:{},createdAt:'stamp',updatedAt:'stamp'};
// @ts-expect-error Only historical readers may accept a missing auxiliary snapshot field.
createStorageJournalDb().beginLocalBirth('orders:local',historicalPlan);
