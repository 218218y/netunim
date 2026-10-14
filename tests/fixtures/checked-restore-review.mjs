import {createRestoreReviewScope} from '../../shared/restore-review-scope.js';

const scope=createRestoreReviewScope({owner:()=> 'local',generation:()=>1,writable:()=>true});
const review=scope.capture();
/** @type {true} */
const current=scope.assertCurrent(review);
void current;
// @ts-expect-error Unvalidated textual generations cannot authorize restore.
scope.assertCurrent({owner:'local',generation:'1'});
// @ts-expect-error An unknown account identity needs validation.
scope.assertCurrent({owner:{id:'local'},generation:1});
// @ts-expect-error UI status text cannot replace write authority.
createRestoreReviewScope({owner:()=> 'local',generation:()=>1,writable:()=> 'ready'});
