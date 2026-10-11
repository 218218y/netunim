import {assertCloudRecoveryHead} from '../../shared/storage-cloud-recovery.js';
const head={seq:2,base:{owner:'account:orders',epoch:'journal-epoch',revision:11,ackSeq:1},flight:null,control:null};
const expected={owner:'account:orders',epoch:'journal-epoch',seq:2,baseRevision:11,ackSeq:1,checkpointChecksum:'checkpoint-hash',baseChecksum:'base-hash',controlChecksum:null};
assertCloudRecoveryHead(head,expected,null);
// @ts-expect-error sequence must be numeric
assertCloudRecoveryHead(head,{...expected,seq:'2'},null);
// @ts-expect-error login epoch cannot substitute for the journal epoch
assertCloudRecoveryHead(head,{...expected,epoch:1},null);
// @ts-expect-error recovery cannot clear business conflicts or retry controls
assertCloudRecoveryHead(head,expected,'merge-conflict');
// @ts-expect-error capturing all checksums is required
assertCloudRecoveryHead(head,{owner:'account',epoch:'epoch',seq:2,baseRevision:11,ackSeq:1},null);
