// @ts-check
import {readCloudWriteScope,captureCloudWriteScope,cloudWriteScopeIsCurrent} from '../../shared/cloud-write-scope.js';
const live=readCloudWriteScope({owner:'synthetic:orders',epoch:'journal-epoch',accountOwner:'synthetic',writable:true},{owner:'synthetic',epoch:1});
const captured=captureCloudWriteScope(live,{base:{owner:'synthetic:orders',epoch:'journal-epoch'}});
cloudWriteScopeIsCurrent(captured,live);
// @ts-expect-error Journal epoch is not the numeric login epoch.
readCloudWriteScope({owner:'synthetic:orders',epoch:1,accountOwner:'synthetic',writable:true},{owner:'synthetic',epoch:1});
// @ts-expect-error A login epoch is not a storage epoch string.
readCloudWriteScope({owner:'synthetic:orders',epoch:'journal-epoch',accountOwner:'synthetic',writable:true},{owner:'synthetic',epoch:'1'});
// @ts-expect-error A committed head alone cannot authorize publication.
cloudWriteScopeIsCurrent(captured,{owner:'synthetic:orders',epoch:'journal-epoch'});
// @ts-expect-error Captured identity is immutable.
if(captured)captured.owner='another';
