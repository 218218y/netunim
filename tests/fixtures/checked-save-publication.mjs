import {createSavePublication} from '../../netunim-kupa/site/assets/js/storage/save-publication.js';
/** @typedef {{notes:string[]}} State */
/** @type {import('../../netunim-kupa/site/assets/js/storage/save-publication.js').SavePublicationPorts<State,State>} */
const ports={model:{state:{notes:[]}},session:{connectionMode:'file',backendReady:true,localGeneration:1},
  access:{storageV2Primary:()=>true},projection:{normalizeState:state=>state,prepareKupaCloudState:state=>state},
  cloud:{persistSupabaseState:async()=>true},mirror:{persistState:async()=>true},view:{setSaveStatus:()=>{}},
};
const owner=createSavePublication(ports);
/** @type {Promise<boolean>} */ export const saving=owner.saveFile({notes:[]},'saved',1);
// @ts-expect-error Synchronous primary-writer admission cannot be deferred.
createSavePublication({...ports,access:{storageV2Primary:async()=>true}});
// @ts-expect-error Cloud publication cannot confirm success with text.
createSavePublication({...ports,cloud:{persistSupabaseState:async()=> 'saved'}});
// @ts-expect-error File publication cannot confirm success with a missing receipt.
createSavePublication({...ports,mirror:{persistState:async()=>undefined}});
// @ts-expect-error Snapshot shape cannot be replaced with a numeric status.
owner.requestCloudSave(7,'saved',1);
// @ts-expect-error Local generation cannot be inferred from text.
owner.requestCloudSave({notes:[]},'saved','1');
