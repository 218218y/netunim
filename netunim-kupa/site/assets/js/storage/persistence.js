import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';
import {createLocalCommitOwner} from './local-commit.js';
import {createSavePublication} from './save-publication.js';
import {createLocalFileMirror} from './local-file-mirror.js';
import {createLocalFileAdoption} from './local-file-adoption.js';

// Composition and accepted-work lifetime only. The four owners receive their
// own authority ports; no shared application context or alternate V1 writer.
export function createStoragePersistence({model,session,tab,journal,projection,file,cloud,view}){
  const work=createRuntimeTaskOwner();
  const mirror=createLocalFileMirror({model,session,journal,file,view});
  const publication=createSavePublication({model,session,access:journal,projection,cloud,mirror,view});
  const local=createLocalCommitOwner({model,session,tab,journal,projection,publication,view});
  const adoption=createLocalFileAdoption({model,session,tab,journal,file,projection,view});
  function saveState(...args){return work.isActive()?work.run(()=>local.saveStateAccepted(...args)):Promise.resolve(false)}
  async function recoverLocalState(assertCurrent){
    assertCurrent();const recovered=await journal.recoverStorageV2State();assertCurrent();
    return !!recovered&&journal.storageV2Primary();
  }
  return {
    loadState:async(...args)=>work.run(()=>adoption.loadState(...args)),
    saveState,
    persistState:(...args)=>work.isActive()?work.run(()=>publication.persistState(...args)):Promise.resolve(false),
    recoverLocalState:async(...args)=>work.run(()=>recoverLocalState(...args)),
    runtime:{isPending:work.isPending,drain:work.drain,dispose:work.close},
  };
}
