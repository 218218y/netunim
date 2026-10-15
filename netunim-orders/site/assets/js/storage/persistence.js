import {createOrdersLocalCommit} from './local-commit.js';
import {createOrdersSavePublication} from './save-publication.js';
import {createMainSyncBrowserPorts} from '../shared/main-sync-browser.js';

// Local acceptance captures its receipt; publication coalesces follow-ups.
export function createStoragePersistence({access,session,journal,projection,mirror,cloud,view,platform=createMainSyncBrowserPorts()}) {
  const local=createOrdersLocalCommit({access,session,journal,projection,view,platform});
  const publication=createOrdersSavePublication({session,journal,mirror,cloud,view,platform});
  function accept(message='השינויים נשמרו',options={}) {
    const receipt=local.accept(options);
    if (receipt) publication.schedule(receipt,message);
    return receipt;
  }
  function scheduleSave(message,options) { return accept(message,options)?.localOk??false; }
  async function commitSave(message,{operations,...options}={}) {
    if (!Array.isArray(operations)||!operations.length) throw new TypeError('storage_mutation_contract_required');
    const receipt=accept(message,{...options,operations});
    if (!receipt?.accepted) return false;
    if (!receipt.committed) throw new Error('storage_local_commit_receipt_required');
    return await receipt.committed===true&&!session.localUndurableGenerations?.has(receipt.generation);
  }
  const runtime={
    cancelPending:()=>publication.cancelPending(),
    async drain() { await Promise.all([local.drain(),publication.drain()]); },
    dispose() { const changed=local.dispose(); publication.dispose(); return changed; },
  };
  return {canMutate:local.canMutate,rejectSecondaryAction:local.rejectSecondaryAction,
    rejectSecondaryMutation:local.rejectSecondaryMutation,scheduleSave,commitSave,runtime};
}
