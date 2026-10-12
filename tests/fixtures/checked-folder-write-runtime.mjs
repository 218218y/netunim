import {createFolderWriteRuntime} from '../../netunim-orders/site/assets/js/storage/folder-write-runtime.js';
/** @param {{notes:string[]}} payload */
const clonePayload=payload=>structuredClone(payload);
const runtime=createFolderWriteRuntime({
  readTarget:()=>({name:'selected directory'}),clonePayload,
  canStart:()=>true,
  /** @param {{name:string}} target @param {{notes:string[]}} payload */
  write:async(target,payload,command,scope)=>scope.begin()&&!!target.name&&payload.notes.length>=0&&typeof command.forceBackup==='boolean',
  onError:()=>{},
});
runtime.mirror({notes:['retained input']},true);
runtime.snapshot({notes:[]});runtime.preserve({notes:[]});
// @ts-expect-error Captured payloads retain their actual domain shape.
runtime.snapshot({notes:123});
// @ts-expect-error A forced safety copy requires a boolean command.
runtime.mirror({notes:[]},'force');
/** @type {Promise<boolean>} */
const receipt=runtime.snapshot({notes:[]});void receipt;
// @ts-expect-error A folder receipt is asynchronous, not a guessed boolean.
const guessed=/** @type {boolean} */ (runtime.snapshot({notes:[]}));void guessed;
