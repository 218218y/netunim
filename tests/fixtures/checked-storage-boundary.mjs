import {createStorageV2Boundary} from '../../shared/storage-v2-boundary.js';
import {readStorageBoundary} from '../../shared/storage-operation.js';
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
