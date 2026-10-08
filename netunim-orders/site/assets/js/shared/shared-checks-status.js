import {cloudHeadIsSynced} from './storage-cloud-status.js';
import {normalizeSharedChecks} from './shared-checks-contract.js';
import {equalSyncJson} from './cloud-sync.js';

// The runtime owns ACK/GET and validates the scoped journal. This pure receipt
// check cannot acknowledge work or change retry/control metadata.
export function sharedChecksHeadIsSynced(head,{checks,hasLocalWork,observedHead}={}){
  return hasLocalWork===false&&cloudHeadIsSynced(head,{revision:head?.base?.revision,observedHead})
    &&equalSyncJson(normalizeSharedChecks(checks),normalizeSharedChecks(head?.base?.state?.checks));
}
