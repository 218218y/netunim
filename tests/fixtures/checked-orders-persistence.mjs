import {createOrdersLocalCommit} from '../../netunim-orders/site/assets/js/storage/local-commit.js';
import {createOrdersSavePublication} from '../../netunim-orders/site/assets/js/storage/save-publication.js';
/** @type {Parameters<typeof createOrdersLocalCommit>[0]} */
const ports={access:{primary:()=>true,error:()=>null,showSecondaryTabGuard:()=>{}},session:{localGeneration:0},
  journal:{localSnapshot:()=>false,storageV2CommitPromise:async()=>true,storageV2DurabilityAtRisk:()=>true},
  projection:{touch:()=>{},touchAll:()=>{}},view:{setSave:()=>{},setCloud:()=>{},folderSaveTitle:()=>''},platform:{reload:()=>{}}};
const local=createOrdersLocalCommit(ports);
export const receipt=local.accept({operations:[{type:'set',field:'settings',value:{}}]});
// @ts-expect-error Primary admission is synchronous.
createOrdersLocalCommit({...ports,access:{...ports.access,primary:async()=>true}});
// @ts-expect-error A local commit is an asynchronous receipt, never a scalar success.
createOrdersLocalCommit({...ports,journal:{...ports.journal,storageV2CommitPromise:()=>true}});
// @ts-expect-error Generation is owned numerically.
createOrdersLocalCommit({...ports,session:{localGeneration:'1'}});
/** @type {Parameters<typeof createOrdersSavePublication>[0]} */
const publication={session:ports.session,journal:ports.journal,view:ports.view,mirror:{available:()=>false,write:async()=>true,refreshAccess:()=>{}},cloud:{enabled:()=>true,save:async()=>true},platform:{isOnline:()=>true}};
// @ts-expect-error Connectivity is a synchronous platform observation.
createOrdersSavePublication({...publication,platform:{isOnline:async()=>true}});
